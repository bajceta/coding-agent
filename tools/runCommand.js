const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

async function execute(command) {
    const cwd = process.cwd();
    console.log('Running command in Docker: ' + command);
    try {
        const dockerCommand = `docker run --rm -v ${cwd}:/workspace -w /workspace node:alpine sh -c '${command}'`;
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
}

module.exports = {
    description: 'Run a bash command',
    arguments: [{ command: 'bash command to execute' }],
    execute,
};
