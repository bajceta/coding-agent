const fs = require('fs').promises;
const path = require('path');

async function execute(args) {
  try {
    // Ensure directory exists
    const dir = path.dirname(args.path);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(args.path, args.content, 'utf8');
    return {
      success: true,
      message: `Successfully wrote to ${args.path}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  name: 'writeFile',
  description: 'Write content to a file',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to write'
      },
      content: {
        type: 'string',
        description: 'The content to write to the file'
      }
    },
    required: ['path', 'content']
  },
  execute
};
