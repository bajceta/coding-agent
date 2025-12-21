import { exec } from 'child_process';
import util from 'util';
import type { ExecuteResult } from '../interfaces.ts';
import { getConfig } from '../config.ts';
const execPromise = util.promisify(exec);

async function execute(command: string): Promise<ExecuteResult> {
    const cwd = process.cwd();
    //console.log('Running command: ' + command);

    try {
        if (getConfig()?.container) {
            //console.log('Running command in Docker');
            const dockerCommand = `docker run --rm -v ${cwd}:/workspace -w /workspace agent-runner:1 bash -c '${command}'`;
            const { stdout, stderr } = await execPromise(dockerCommand);
            return {
                success: true,
                content: stdout,
                error: stderr,
            };
        } else {
            // console.log('Running command locally');
            const { error, stdout, stderr } = await execPromise(command, { shell: '/bin/bash' });
            return {
                error,
                stdout,
                stderr,
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
    description: `Run a bash command.
Replace shorter texts in files with 'sed -i' instead of writeFile tool.
Find text in files using 'ag'.
Always ignore node_modules and .git folders.
`,
    arguments: [{ command: 'bash command to execute' }],
    execute,
    enabled: true,
    safe: false,
};
