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

    // Build curl command with proper quoting for arguments that contain spaces
    const curlArgs = ['-s', '-X', method];
    curlArgs.push('-H', `Authorization: token ${token}`);
    curlArgs.push('-H', 'Content-Type: application/json');
    curlArgs.push('-H', 'Accept: application/json');

    if (options?.body) {
        curlArgs.push('-d', options.body);
    }

    curlArgs.push(url);

    // Use proper shell quoting by escaping each argument
    const shellArgs = curlArgs.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`).join(' ');
    const { stdout } = await execAsync(`curl ${shellArgs}`);
    return JSON.parse(stdout);
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

        // If no issues with to-do label, get all open issues
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

        // Use issue.number for the issue identifier (index is null in Forgejo API)
        const issueNumber = issue.number;

        // Update labels: remove to-do, add in-progress
        const currentLabels = issue.labels || [];
        const newLabels = currentLabels
            .filter((l: any) => l.name !== 'to-do')
            .map((l: any) => l.id);

        try {
            await forgejoRequest(
                `/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${issueNumber}`,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ labels: newLabels }),
                },
            );
        } catch {
            // Ignore label update errors
        }

        // Add in-progress label separately
        try {
            await forgejoRequest(
                `/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${issueNumber}/labels`,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'in-progress' }),
                },
            );
        } catch {
            // Label might not exist yet, ignore
        }

        // Return context to agent
        const context = `## Ticket Picked

**Issue #${issueNumber}**: ${issue.title}

**Repository**: ${repoInfo.owner}/${repoInfo.repo}

**Description**:
${issue.body || '(no description)'}

**Labels**: ${currentLabels.map((l: any) => l.name).join(', ')}

---
You can now work on this ticket. When done, use \`forgejoCreatePR\` with issue_number=${issueNumber} and repo=${repoInfo.owner}/${repoInfo.repo} to create a worktree and pull request.`;

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
        'Pick a ticket from Forgejo in to-do state, mark it as in-progress, and return the ticket context (title, description) for the agent to work on. Requires FORGEJO_URL and FORGEJO_TOKEN env vars.',
    arguments: [
        {
            repo: 'Optional: owner/repo (e.g., innomenta/ESSController). Auto-detected from git remote if not provided.',
        },
        { cwd: 'Optional: working directory to run git commands from (for repo detection).' },
    ],
    execute,
    enabled: true,
};
