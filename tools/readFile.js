const fs = require('fs').promises;
const path = require('path');

async function execute(_path) {

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
        const content = await fs.readFile(resolvedPath, 'utf8');
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
    description: 'Read the contents of a file',
    arguments: [
        { "path": "path to the file to read" },
    ],
    execute
};
