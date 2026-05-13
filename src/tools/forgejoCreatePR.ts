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
                urlMatch = line.match(/[\s:]+(git@[^:\/]+:|https?:\/\/)([^\/:]+)\/([^\/\s]+)\.git/);
                if (urlMatch) {
                    return { owner: urlMatch[2], repo: urlMatch[3] };
                }
            }
        }
        return null;
    } catch (error) {
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

async function execute(issue_number: string, repo?: string, cwd?: string): Promise<ExecuteResult> {
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
                error: 'Could not detect repository. Provide repo parameter (owner/repo).',
            };
        }

        const issueNum = parseInt(issue_number, 10);
        if (isNaN(issueNum)) {
            return {
                success: false,
                content: null,
                error: 'Invalid issue number.',
            };
        }

        const branchName = `issue-${issueNum}`;
        const defaultWorktreePath = `.worktrees/issue-${issueNum}`;
        const wtPath = cwd ? `${cwd}/${defaultWorktreePath}` : defaultWorktreePath;

        // Fetch issue details for PR title/description
        const issue = await forgejoRequest(
            `/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${issueNum}`,
        );
        if (!issue) {
            return {
                success: false,
                content: null,
                error: `Issue #${issueNum} not found.`,
            };
        }

        // Determine base directory for git commands
        const gitCwd = cwd || '.';

        // Create worktree with new branch
        const { stdout: worktreeOutput, stderr: worktreeError } = await execAsync(
            `git worktree add ${wtPath} -b ${branchName}`,
            { cwd: gitCwd },
        );
        if (worktreeError && !worktreeOutput.includes('Preparing working directory')) {
            return {
                success: false,
                content: null,
                error: `Failed to create worktree: ${worktreeError}`,
            };
        }

        // Push the branch
        await execAsync(`git push -u origin ${branchName}`, { cwd: gitCwd });

        // Create PR via Forgejo API
        const prBody = `${issue.body || ''}\n\nCloses #${issueNum}`;

        const pr = await forgejoRequest(`/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`, {
            method: 'POST',
            body: JSON.stringify({
                title: issue.title,
                body: prBody,
                head: branchName,
                base: issue.base?.branch || 'main',
            }),
        });

        const result = `## Pull Request Created

**PR #${pr.number}**: ${pr.title}

**PR URL**: ${pr.html_url}

**Branch**: ${branchName}

**Worktree path**: ${wtPath}

**Issue**: #${issueNum} (linked in description)

---
You can now switch to the worktree with: \`cd ${wtPath}\`
Make your changes, commit, and push to ${branchName}. The PR will update automatically.`;

        return {
            success: true,
            content: result,
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
        'Create a git worktree and pull request in Forgejo for a given issue. Creates a branch named issue-{number}, sets up a worktree, and opens a PR with the issue linked in the description.',
    arguments: [
        { issue_number: 'The issue number to create a PR for' },
        {
            repo: 'Optional: owner/repo (e.g., innomenta/ESSController). Auto-detected from git remote if not provided.',
        },
        {
            cwd: 'Optional: working directory to run git commands from (for repo detection and worktree creation).',
        },
    ],
    execute,
    enabled: true,
};
