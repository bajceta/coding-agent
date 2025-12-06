const fs = require('fs').promises;

async function execute(path) {
    console.log("READFILE: " + path);
  try {
    const content = await fs.readFile(path, 'utf8');
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
  arguments: [
      {"path": "path to the file to read"},
  ],
  execute
};
