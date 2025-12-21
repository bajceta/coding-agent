import { exec } from 'child_process';
import type { ExecuteResult } from '../interfaces.ts';
import { getConfig } from '../config.ts';
import Log from '../log.ts';
const log = Log.get('runCommand');

const execRun = (cmd, options = {}) => {
    return new Promise((resolve) => {
        exec(cmd, options, (error, stdout, stderr) => {
            resolve({
                error,
                stdout,
                stderr,
            });
        });
    });
};

async function execute(command: string): Promise<ExecuteResult> {
    const cwd = process.cwd();
    if (getConfig()?.container) {
        //console.log('Running command in Docker');
        log.debug('Run in docker: ' + command);
        const dockerCommand = `docker run --rm -v ${cwd}:/workspace -w /workspace agent-runner:1 bash -c '${command}'`;
        const result: any = await execRun(dockerCommand);
        return {
            success: !result.error,
            content: result.stdout,
            error: result.error?.message || null,
        };
    } else {
        // console.log('Running command locally');
        log.debug('Run in bash: ' + command);
        const result: any = await execRun(command, { shell: '/bin/bash' });
        return {
            success: !result.error,
            content: result.stdout,
            error: result.error?.message || null,
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
