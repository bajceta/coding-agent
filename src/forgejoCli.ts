import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Search for open Forgejo issues using the fj CLI.
 * Returns the first issue number found, or null if none.
 */
export async function searchIssues(): Promise<{ number: number; title: string } | null> {
    try {
        const { stdout } = await execAsync('fj issue search -a aiagent -s open -l todo');
        // Parse output like:
        // 1 issue
        // #4: Add forgejo action (by vlada)
        const match = stdout.match(/#(\d+):\s*(.+)/);
        if (match) {
            return {
                number: parseInt(match[1], 10),
                title: match[2].trim(),
            };
        }
        return null;
    } catch (error: any) {
        throw new Error(`Failed to search issues: ${error.message}`);
    }
}

/**
 * View issue details using the fj CLI.
 * Returns parsed issue data.
 */
export async function viewIssue(issueNumber: number): Promise<{
    number: number;
    title: string;
    body: string;
}> {
    try {
        const { stdout } = await execAsync(`fj issue view ${issueNumber}`);
        // Parse output like:
        // Add forgejo action #4
        // By vlada — Open
        //  todo
        //
        // ▌ action should run:
        // ▌
        // ▌ • pnpm run lint
        // ▌ • pnpm run test
        // ▌
        //
        // 0 comments

        // Extract title and issue number from first line
        const firstLine = stdout.split('\n')[0] || '';
        const titleMatch = firstLine.match(/^(.+?)\s+#(\d+)\s*$/);
        const title = titleMatch ? titleMatch[1].trim() : firstLine.trim();

        // Extract body: lines starting with "▌" are body content
        const bodyLines: string[] = [];
        for (const line of stdout.split('\n')) {
            if (line.startsWith('▌')) {
                bodyLines.push(line.slice(2).trim());
            }
        }

        // Clean up body: remove leading bullet markers and empty lines
        const body = bodyLines
            .map((l) => l.replace(/^•\s*/, ''))
            .filter((l) => l.length > 0)
            .join('\n');

        return {
            number: issueNumber,
            title,
            body,
        };
    } catch (error: any) {
        throw new Error(`Failed to view issue #${issueNumber}: ${error.message}`);
    }
}

/**
 * Detect owner/repo from git remote origin URL.
 */
export async function detectRepo(cwd?: string): Promise<{ owner: string; repo: string } | null> {
    try {
        const { stdout } = await execAsync('git remote -v', cwd ? { cwd } : undefined);
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
            if (line.includes('(fetch)')) {
                // ssh://git@host/owner/repo.git
                let urlMatch = line.match(/ssh:\/\/git@[^\/]+\/([^\/]+)\/([^\/\s]+)\.git/);
                if (urlMatch) {
                    return { owner: urlMatch[1], repo: urlMatch[2] };
                }
                // git@host:owner/repo.git or https://host/owner/repo.git
                urlMatch = line.match(
                    /[\s:]+(git@[^:\/]+:|https?:\/\/[^\/]+)([^\/]+)\/([^\/\s]+)\.git/,
                );
                if (urlMatch) {
                    return { owner: urlMatch[2], repo: urlMatch[3] };
                }
            }
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Make authenticated request to Forgejo API via curl.
 */
async function forgejoRequest(
    endpoint: string,
    options?: { method?: string; body?: string },
): Promise<any> {
    const baseUrl = process.env.FORGEJO_URL;
    const token = process.env.FORGEJO_TOKEN;

    if (!baseUrl || !token) {
        throw new Error('FORGEJO_URL and FORGEJO_TOKEN environment variables must be set');
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/${endpoint.replace(/^\/+/, '')}`;
    const method = options?.method || 'GET';

    const args = [
        '-s',
        '-X',
        method,
        '-H',
        `Authorization: token ${token}`,
        '-H',
        'Content-Type: application/json',
        '-H',
        'Accept: application/json',
    ];

    if (options?.body) {
        args.push('-d', options.body);
    }

    args.push(url);

    const { stdout } = await execAsync(`curl ${args.join(' ')}`);
    return JSON.parse(stdout);
}

/**
 * Pick a Forgejo issue via CLI, create worktree, branch, PR, and push.
 * @param issueNumber Optional: if provided, skip search and use this number
 * @param cwd Optional working directory
 */
export async function pickIssue(issueNumber?: number, cwd?: string): Promise<string> {
    // Detect repo
    const repoInfo = await detectRepo(cwd);
    if (!repoInfo) {
        throw new Error(
            'Could not detect repository. Ensure you are in a git repo with a remote origin.',
        );
    }

    const gitCwd = cwd || '.';

    // Find or use provided issue number
    let issue: { number: number; title: string; body: string };
    if (issueNumber) {
        issue = await viewIssue(issueNumber);
    } else {
        const searchResult = await searchIssues();
        if (!searchResult) {
            throw new Error('No open issues found with label "todo" and assignee "aiagent".');
        }
        issue = await viewIssue(searchResult.number);
    }
    // Remove "todo" label and add "wip" label
    await execAsync(`fj issue edit ${issue.number} labels -r todo`, { cwd: gitCwd });
    await execAsync(`fj issue edit ${issue.number} labels -a wip`, { cwd: gitCwd });
    const branchName = `issue-${issue.number}`;
    const worktreePath = `.worktrees/issue-${issue.number}`;
    const wtPath = cwd ? `${cwd}/${worktreePath}` : worktreePath;

    // Fetch latest
    await execAsync('git fetch origin', { cwd: gitCwd });

    // Check if worktree already exists
    let worktreeExists = false;
    try {
        const { stdout: wtList } = await execAsync('git worktree list --porcelain', {
            cwd: gitCwd,
        });
        worktreeExists = wtList.includes(wtPath);
    } catch {
        // If we can't list worktrees, proceed
    }

    // Check if branch exists
    let branchExists = false;
    try {
        await execAsync(`git rev-parse --verify ${branchName}`, { cwd: gitCwd });
        branchExists = true;
    } catch {
        // Check remote
        try {
            await execAsync(`git rev-parse --verify origin/${branchName}`, { cwd: gitCwd });
            await execAsync(`git branch ${branchName} origin/${branchName}`, { cwd: gitCwd });
            branchExists = true;
        } catch {
            // Branch doesn't exist
        }
    }

    // Create worktree if needed
    if (!worktreeExists) {
        const worktreeCmd = branchExists
            ? `git worktree add ${wtPath} ${branchName}`
            : `git worktree add ${wtPath} -b ${branchName}`;

        try {
            await execAsync(worktreeCmd, { cwd: gitCwd });
        } catch (error: any) {
            const errorMsg = error.stderr || error.message || '';
            if (errorMsg.includes('fatal:') || errorMsg.includes('error:')) {
                throw new Error(`Failed to create worktree: ${errorMsg}`);
            }
        }
    }

    // Push branch using SSH key
    const pushEnv: Record<string, string> = {};
    if (process.env.AGENT_SSH_KEY) {
        pushEnv.GIT_SSH_COMMAND = `ssh -i ${process.env.AGENT_SSH_KEY} -o StrictHostKeyChecking=no`;
    }
    await execAsync(`git push -u origin ${branchName}`, {
        cwd: gitCwd,
        env: { ...process.env, ...pushEnv },
    });

    return `## Ticket Picked

**Issue #${issue.number}**: ${issue.title}

**Repository**: ${repoInfo.owner}/${repoInfo.repo}

**Description**:
${issue.body || '(no description)'}

---

## Pull Request Created

**Branch**: ${branchName}
**Worktree path**: ${wtPath}

---
You can now switch to the worktree with: \`cd ${wtPath}\`
Make your changes, commit, and push to ${branchName}. The PR will update automatically.
create pr with \` fj pr create "${issue.title}" --body "a longer description"\``;
}
