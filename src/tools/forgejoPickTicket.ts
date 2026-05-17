import { exec } from 'child_process';
import { promisify } from 'util';
import type { ExecuteResult } from '../interfaces.ts';

const execAsync = promisify(exec);

/**
 * Extract owner/repo from git remote origin URL
 * Handles: git@host:owner/repo.git, https://host/owner/repo.git, ssh://git@host/owner/repo.git
 */
async function detectRepo(cwd?: string): Promise<{ owner: string; repo: string } | null> {
    try {
        const cmd = 'git remote -v';
        const { stdout } = await execAsync(cmd, cwd ? { cwd } : undefined);
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
                    /[\s:]+(git@[^:\/]+:|https?:\/\/[^\/]+)\/([^\/]+)\/([^\/\s]+)\.git/,
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
 * Make authenticated request to Forgejo API
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

    const curlArgs = ['-s', '-X', method];
    curlArgs.push('-H', `Authorization: token ${token}`);
    curlArgs.push('-H', 'Content-Type: application/json');
    curlArgs.push('-H', 'Accept: application/json');

    if (options?.body) {
        curlArgs.push('-d', options.body);
    }

    curlArgs.push(url);

    const shellArgs = curlArgs.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`).join(' ');
    const { stdout } = await execAsync(`curl ${shellArgs}`);
    return JSON.parse(stdout);
}

/**
 * Update issue labels: remove to-do, add in-progress
 */
async function markInProgress(
    owner: string,
    repo: string,
    issueNumber: number,
    currentLabels: any[],
): Promise<void> {
    const newLabels = currentLabels.filter((l: any) => l.name !== 'to-do').map((l: any) => l.id);

    try {
        await forgejoRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
            method: 'PATCH',
            body: JSON.stringify({ labels: newLabels }),
        });
    } catch {
        // Ignore label update errors
    }

    try {
        await forgejoRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
            method: 'POST',
            body: JSON.stringify({ name: 'in-progress' }),
        });
    } catch {
        // Label might not exist yet, ignore
    }
}

async function execute(repo?: string, cwd?: string): Promise<ExecuteResult> {
    try {
        // Use provided repo or detect from git remote
        let repoInfo: { owner: string; repo: string } | null = null;

        if (repo) {
            const parts = repo.split('/');
            if (parts.length === 2) {
                repoInfo = { owner: parts[0], repo: parts[1] };
            } else {
                return {
                    success: false,
                    content: null,
                    error: 'Invalid repo format. Use owner/repo (e.g., innomenta/ESSController).',
                };
            }
        } else {
            repoInfo = await detectRepo(cwd);
        }

        if (!repoInfo) {
            return {
                success: false,
                content: null,
                error: 'Could not detect repository. Provide repo parameter (owner/repo) or ensure you are in a git repo with a remote origin.',
            };
        }

        // Fetch open issues, try with to-do label first, fallback to all open issues
        let issues = await forgejoRequest(
            `/repos/${repoInfo.owner}/${repoInfo.repo}/issues?state=open&labels=to-do`,
        );

        if (!issues || issues.length === 0) {
            issues = await forgejoRequest(
                `/repos/${repoInfo.owner}/${repoInfo.repo}/issues?state=open`,
            );
        }

        if (!issues || issues.length === 0) {
            return {
                success: true,
                content: `No open issues found in ${repoInfo.owner}/${repoInfo.repo}.`,
                error: null,
            };
        }

        // Pick the first issue
        const issue = issues[0];
        const issueNumber = issue.number;
        const currentLabels = issue.labels || [];

        // Mark issue as in-progress
        await markInProgress(repoInfo.owner, repoInfo.repo, issueNumber, currentLabels);

        // Create worktree and branch
        const branchName = `issue-${issueNumber}`;
        const defaultWorktreePath = `.worktrees/issue-${issueNumber}`;
        const wtPath = cwd ? `${cwd}/${defaultWorktreePath}` : defaultWorktreePath;
        const gitCwd = cwd || '.';

        // Fetch latest state from remote
        await execAsync('git fetch origin', { cwd: gitCwd });

        // Check if worktree already exists
        let worktreeExists = false;
        try {
            const { stdout: wtList } = await execAsync('git worktree list --porcelain', {
                cwd: gitCwd,
            });
            worktreeExists = wtList.includes(wtPath);
        } catch {
            // If we can't list worktrees, proceed with creation
        }

        if (worktreeExists) {
            // Worktree already exists, skip creation
        } else {
            // Check if branch already exists (local or remote)
            let branchExists = false;
            try {
                const { stdout: branchCheck } = await execAsync(
                    `git rev-parse --verify ${branchName}`,
                    { cwd: gitCwd },
                );
                branchExists = !!branchCheck.trim();
            } catch {
                // Check remote
                try {
                    const { stdout: remoteCheck } = await execAsync(
                        `git rev-parse --verify origin/${branchName}`,
                        { cwd: gitCwd },
                    );
                    if (remoteCheck.trim()) {
                        // Remote branch exists — create local branch tracking it
                        await execAsync(`git branch ${branchName} origin/${branchName}`, {
                            cwd: gitCwd,
                        });
                        branchExists = true;
                    }
                } catch {
                    // Branch doesn't exist anywhere
                }
            }

            const worktreeCmd = branchExists
                ? `git worktree add ${wtPath} ${branchName}`
                : `git worktree add ${wtPath} -b ${branchName}`;

            try {
                await execAsync(worktreeCmd, { cwd: gitCwd });
            } catch (error: any) {
                const errorMsg = error.stderr || error.message || '';
                // Only fail on actual errors, not git's informational messages
                if (errorMsg.includes('fatal:') || errorMsg.includes('error:')) {
                    return {
                        success: false,
                        content: null,
                        error: `Failed to create worktree: ${errorMsg}`,
                    };
                }
                // Git outputs "Preparing worktree" to stderr but command succeeded
            }
        }

        // Push the branch using SSH key from AGENT_SSH_KEY
        const pushEnv: Record<string, string> = {};
        if (process.env.AGENT_SSH_KEY) {
            pushEnv.GIT_SSH_COMMAND = `ssh -i ${process.env.AGENT_SSH_KEY} -o StrictHostKeyChecking=no`;
        }
        await execAsync(`git push -u origin ${branchName}`, {
            cwd: gitCwd,
            env: { ...process.env, ...pushEnv },
        });

        // Check if PR already exists for this branch
        const existingPRs = await forgejoRequest(
            `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls?state=open&head=${branchName}`,
        );

        let pr: any;
        if (existingPRs && existingPRs.length > 0) {
            pr = existingPRs[0];
        } else {
            // Create PR via Forgejo API
            const prBody = `${issue.body || ''}\n\nCloses #${issueNumber}`;

            pr = await forgejoRequest(`/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`, {
                method: 'POST',
                body: JSON.stringify({
                    title: issue.title,
                    body: prBody,
                    head: branchName,
                    base: issue.base?.branch || 'main',
                }),
            });
        }

        // Return context to agent
        const context = `## Ticket Picked

**Issue #${issueNumber}**: ${issue.title}

**Repository**: ${repoInfo.owner}/${repoInfo.repo}

**Description**:
${issue.body || '(no description)'}

**Labels**: ${currentLabels.map((l: any) => l.name).join(', ')}

---

## Pull Request Created

**PR #${pr.number}**: ${pr.title}
**PR URL**: ${pr.html_url}
**Branch**: ${branchName}
**Worktree path**: ${wtPath}

---
You can now switch to the worktree with: \`cd ${wtPath}\`
Make your changes, commit, and push to ${branchName}. The PR will update automatically.`;

        return {
            success: true,
            content: context,
            error: null,
        };
    } catch (error) {
        return {
            success: false,
            content: null,
            error: (error as Error).message,
        };
    }
}

export default {
    description:
        'Pick a ticket from Forgejo in to-do state, mark it as in-progress, create a git worktree and pull request, and return the ticket context (title, description) for the agent to work on. Requires FORGEJO_URL and FORGEJO_TOKEN env vars.',
    arguments: [
        {
            repo: 'Optional: owner/repo (e.g., innomenta/ESSController). Auto-detected from git remote if not provided.',
        },
        {
            cwd: 'Optional: working directory to run git commands from (for repo detection and worktree creation).',
        },
    ],
    execute,
    enabled: false,
};
