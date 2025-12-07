const fs = require('fs').promises;
const path = require('path');

async function execute(_path, content) {
  try {
    // Get current working directory
    const cwd = process.cwd();
    
    // Resolve the provided path to an absolute path
    const resolvedPath = path.resolve(_path);
    
    // Check if the resolved path is within the current working directory
    if (!resolvedPath.startsWith(cwd + path.sep) && resolvedPath !== cwd) {
      return {
        success: false,
        error: 'Path must be within the current working directory'
      };
    }

    // Ensure directory exists
    const dir = path.dirname(resolvedPath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(resolvedPath, content, 'utf8');
    return {
      success: true,
      message: `Successfully wrote to ${resolvedPath}`
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