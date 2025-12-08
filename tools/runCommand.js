const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

async function execute(command, config) {
    const cwd = process.cwd();
    console.log('Running command: ' + command);
    
    // Check if Docker is enabled in config
    const useDocker = config && config.useDocker !== false;
    
    if (useDocker) {
        console.log('Running command in Docker');
        try {
            const dockerCommand = `docker run --rm -v ${cwd}:/workspace -w /workspace agent-runner:1 sh -c '${command}'`;
            const { stdout, stderr } = await execPromise(dockerCommand);
            return {
                success: true,
                content: stdout,
                stderr: stderr,
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                code: error.code,
            };
        }
    } else {
        console.log('Running command locally');
        try {
            const { stdout, stderr } = await execPromise(command);
            return {
                success: true,
                content: stdout,
                stderr: stderr,
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                code: error.code,
            };
        }
    }
}

module.exports = {
    description: 'Run a bash command',
    arguments: [{ command: 'bash command to execute' }],
    execute,
};