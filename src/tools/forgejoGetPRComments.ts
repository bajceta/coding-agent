import { exec } from 'child_process';
import { promisify } from 'util';
import type { ExecuteResult } from '../interfaces.ts';

const execAsync = promisify(exec);

/**
 * Extract owner/repo from git remote origin URL
 */
async function detectRepo(cwd?: string): Promise<{ owner: string; repo: string } | null> {
    try {
        const cmd = 'git remote -v';
        const { stdout } = await execAsync(cmd, cwd ? { cwd } : undefined);
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
            if (line.includes('(fetch)')) {
                let urlMatch = line.match(/ssh:\/\/git@[^\/]+\/([^\/]+)\/([^\/\s]+)\.git/);
                if (urlMatch) {
                    return { owner: urlMatch[1], repo: urlMatch[2] };
                }
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

async function execute(pr_number: string, repo?: string, cwd?: string): Promise<ExecuteResult> {
    try {
        // Resolve repo
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

        const prNum = parseInt(pr_number, 10);
        if (isNaN(prNum)) {
            return {
                success: false,
                content: null,
                error: 'Invalid PR number.',
            };
        }

        // Fetch PR details
        const pr = await forgejoRequest(`/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNum}`);
        if (!pr) {
            return {
                success: false,
                content: null,
                error: `PR #${prNum} not found.`,
            };
        }

        // Fetch general discussion comments (issues/comments endpoint)
        const issueComments: any[] =
            (await forgejoRequest(
                `/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${prNum}/comments`,
            )) || [];

        // Fetch inline code review comments
        const codeComments: any[] =
            (await forgejoRequest(
                `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNum}/comments`,
            )) || [];

        // Fetch reviews (approval/rejection with optional body)
        const reviews: any[] =
            (await forgejoRequest(
                `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNum}/reviews`,
            )) || [];

        // Format output
        let output = `## PR #${prNum} Comments\n\n`;
        output += `**Title**: ${pr.title}\n`;
        output += `**State**: ${pr.state}\n`;
        output += `**URL**: ${pr.html_url}\n\n`;

        // Reviews section
        if (reviews.length > 0) {
            output += `### Reviews (${reviews.length})\n\n`;
            for (const review of reviews) {
                output += `- **${review.user?.login || 'unknown'}**: ${review.state}`;
                if (review.body) {
                    output += ` — ${review.body}`;
                }
                output += `\n`;
            }
            output += `\n`;
        }

        // Discussion comments
        if (issueComments.length > 0) {
            output += `### Discussion Comments (${issueComments.length})\n\n`;
            for (const comment of issueComments) {
                output += `**${comment.user?.login || 'unknown'}** (${comment.created_at?.split('T')[0] || ''}):\n`;
                output += `${comment.body || '(empty)'}\n\n`;
            }
        }

        // Code review comments
        if (codeComments.length > 0) {
            output += `### Code Review Comments (${codeComments.length})\n\n`;
            for (const comment of codeComments) {
                const path = comment.path ? `\`${comment.path}\`` : 'unknown file';
                const line = comment.line ? `:line ${comment.line}` : '';
                output += `**${comment.user?.login || 'unknown'}** on ${path}${line}:\n`;
                output += `${comment.body || '(empty)'}\n\n`;
            }
        }

        // Summary
        const total = reviews.length + issueComments.length + codeComments.length;
        if (total === 0) {
            output += `No comments found for PR #${prNum}.\n`;
        } else {
            output += `---\n`;
            output += `**Summary**: ${reviews.length} review(s), ${issueComments.length} discussion comment(s), ${codeComments.length} code comment(s)\n`;
        }

        return {
            success: true,
            content: output,
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
        'Fetch all comments (discussion, code review, and reviews) for a pull request from Forgejo. Returns formatted output with reviews, discussion comments, and inline code comments. Requires FORGEJO_URL and FORGEJO_TOKEN env vars.',
    arguments: [
        { pr_number: 'The PR number to fetch comments for' },
        {
            repo: 'Optional: owner/repo (e.g., innomenta/ESSController). Auto-detected from git remote if not provided.',
        },
        { cwd: 'Optional: working directory to run git commands from (for repo detection).' },
    ],
    execute,
    enabled: false,
};
