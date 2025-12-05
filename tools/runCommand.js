const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

async function execute(args) {
  try {
    const { stdout, stderr } = await execPromise(args.command);
    return {
      success: true,
      stdout: stdout,
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
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute'
      }
    },
    required: ['command']
  },
  execute
};
