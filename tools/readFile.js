const fs = require('fs').promises;

async function execute(args) {
  try {
    const content = await fs.readFile(args.path, 'utf8');
    return {
      success: true,
      content: content
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  name: 'readFile',
  description: 'Read the contents of a file',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to read'
      }
    },
    required: ['path']
  },
  execute
};
