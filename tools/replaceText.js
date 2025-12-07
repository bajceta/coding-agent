const fs = require('fs').promises;
const path = require('path');

async function execute(_path, oldText, newText) {
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

    // Read the file content
    const content = await fs.readFile(resolvedPath, 'utf8');
    
    // Replace all occurrences of oldText with newText
    const newContent = content.split(oldText).join(newText);
    
    // Write the updated content back to the file
    await fs.writeFile(resolvedPath, newContent, 'utf8');
    
    return {
      success: true,
      message: `Successfully replaced text in ${resolvedPath}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  description: 'Replace text in a file',
  arguments: [
      {"path": "path to the file to modify"},
      {"oldText": "text to be replaced"},
      {"newText": "replacement text"}
  ],
  execute
};