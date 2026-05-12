import { spawn } from 'child_process';
import type { ExecuteResult } from '../interfaces.ts';
import { getConfig } from '../config.ts';
import Log from '../log.ts';
import eventBus from '../eventBus.ts';

const log = Log.get('runCommand');

const TOOL_TIMEOUT_MS = 30000; // 30 seconds

// Store reference to the currently running child process
let currentChildProcess: ReturnType<typeof spawn> | null = null;

// Listen for stop_tool event to kill the running command
eventBus.on('stop_tool', () => {
    if (currentChildProcess && !currentChildProcess.killed) {
        log.info('Stopping running command...');
        currentChildProcess.kill('SIGTERM');
        // Force kill after a brief grace period
        setTimeout(() => {
            if (currentChildProcess && !currentChildProcess.killed) {
                currentChildProcess.kill('SIGKILL');
            }
        }, 1000);
    }
});

const runCommandWithTimeout = (
    cmd: string,
    options?: { shell?: string },
): Promise<{
    error: Error | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}> => {
    return new Promise((resolve) => {
        const shell = options?.shell || '/bin/bash';
        const child = spawn(cmd, {
            shell,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        // Store reference so stop_tool event can kill it
        currentChildProcess = child;

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let resolved = false;

        const cleanup = () => {
            if (currentChildProcess === child) {
                currentChildProcess = null;
            }
        };

        const timeout = setTimeout(() => {
            if (resolved) return;
            timedOut = true;
            child.kill('SIGTERM');
            // Force kill after a brief grace period
            setTimeout(() => {
                if (!child.killed) {
                    child.kill('SIGKILL');
                }
            }, 1000);
        }, TOOL_TIMEOUT_MS);

        child.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            cleanup();
            if (timedOut) {
                resolve({
                    error: new Error(`Command timed out after ${TOOL_TIMEOUT_MS / 1000} seconds`),
                    stdout,
                    stderr,
                    timedOut: true,
                });
            } else {
                resolve({
                    error: code !== 0 ? new Error(`Command exited with code ${code}`) : null,
                    stdout,
                    stderr,
                    timedOut: false,
                });
            }
        });

        child.on('error', (error) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            cleanup();
            resolve({
                error,
                stdout,
                stderr,
                timedOut: false,
            });
        });
    });
};

async function execute(command: string): Promise<ExecuteResult> {
    const cwd = process.cwd();

    if (getConfig()?.container) {
        log.debug('Run in docker: ' + command);
        const dockerCommand = `docker run --rm -v ${cwd}:/workspace -w /workspace agent-runner:1 bash -c '${command}'`;
        const result = await runCommandWithTimeout(dockerCommand);

        let content = result.stdout;
        if (result.stderr) {
            content += result.stderr;
        }
        if (result.timedOut) {
            content += `\n\n[Command was automatically terminated after timeout]`;
        }

        return {
            success: !result.error,
            content,
            error: result.error?.message || null,
        };
    } else {
        log.debug('Run in bash: ' + command);
        const result = await runCommandWithTimeout(command, { shell: '/bin/bash' });

        let content = result.stdout;
        if (result.stderr) {
            content += result.stderr;
        }
        if (result.timedOut) {
            content += `\n\n[Command was automatically terminated after timeout]`;
        }

        return {
            success: !result.error,
            content,
            error: result.error?.message || null,
        };
    }
}

export default {
    description: `Run a bash command. Commands are automatically terminated after 30 seconds.`,
    arguments: [{ command: 'bash command to execute' }],
    execute,
    enabled: true,
    safe: false,
};
