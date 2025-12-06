const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

async function execute(command) {
    console.log("Running command: " + command);
    try {
        const { stdout, stderr } = await execPromise(command);
        return {
            success: true,
            content: stdout,
            stderr: stderr
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            code: error.code
        };
    }
}

module.exports = {
    name: 'runCommand',
    description: 'Run a bash command',
    arguments: [
        { "command": "bash command to execute" },
    ],
    execute,
};
