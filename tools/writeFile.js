const fs = require('fs').promises;
const path = require('path');

async function execute(_path, content) {
  try {
    // Ensure directory exists
    const dir = path.dirname(_path);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(_path, content, 'utf8');
    return {
      success: true,
      message: `Successfully wrote to ${_path}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  description: 'Write content to a file',
  arguments: [
      {"path":"path to the file to write"},
      {"content": "contents of the file to write"}
  ],
  execute
};
