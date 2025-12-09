import { exec } from 'child_process';
import util from 'util';
import type { ExecuteResult } from '../interfaces.ts';

const execPromise = util.promisify(exec);

async function execute(command: string, config?: { useDocker?: boolean }): Promise<ExecuteResult> {
    const cwd = process.cwd();
    console.log('Running command: ' + command);

    const useDocker = config?.useDocker !== false;

    try {
        if (useDocker) {
            console.log('Running command in Docker');
            const dockerCommand = `docker run --rm -v ${cwd}:/workspace -w /workspace agent-runner:1 sh -c '${command}'`;
            const { stdout } = await execPromise(dockerCommand);
            return {
                success: true,
                content: stdout,
                error: null,
            };
        } else {
            console.log('Running command locally');
            const { stdout } = await execPromise(command);
            return {
                success: true,
                content: stdout,
                error: null,
            };
        }
    } catch (error) {
        return {
            success: false,
            content: null,
            error: error.message,
        };
    }
}

// Export module
export default {
    description: 'Run a bash command',
    arguments: [{ command: 'bash command to execute' }],
    execute,
};
