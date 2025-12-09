const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

async function execute(command, config) {
    const cwd = process.cwd();
    console.log('Running command: ' + command);

    const useDocker = config && config.useDocker !== false;

    try {
        if (useDocker) {
            console.log('Running command in Docker');
            const dockerCommand = `docker run --rm -v ${cwd}:/workspace -w /workspace agent-runner:1 sh -c '${command}'`;
            const { stdout, stderr } = await execPromise(dockerCommand);
            return {
                success: true,
                content: stdout,
                stderr: stderr,
                error: null,
            };
        } else {
            console.log('Running command locally');
            const { stdout, stderr } = await execPromise(command);
            return {
                success: true,
                content: stdout,
                stderr: stderr,
                error: null,
            };
        }
    } catch (error) {
        return {
            success: false,
            content: null,
            stderr: error.stderr || '',
            error: error.message,
            code: error.code,
        };
    }
}

module.exports = {
    description: 'Run a bash command',
    arguments: [{ command: 'bash command to execute' }],
    execute,
};
