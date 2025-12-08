const fs = require('fs').promises;
const path = require('path');

async function execute(_path) {
    try {
        const cwd = process.cwd();
        const resolvedPath = path.resolve(_path);
        
        if (!resolvedPath.startsWith(cwd + path.sep) && resolvedPath !== cwd) {
            return {
                success: false,
                content: null,
                error: 'Path must be within the current working directory',
            };
        }
        
        const content = await fs.readFile(resolvedPath, 'utf8');
        return {
            success: true,
            content: content,
            error: null
        };
    } catch (error) {
        return {
            success: false,
            content: null,
            error: error.message,
        };
    }
}

module.exports = {
    description: 'Read the contents of a file',
    arguments: [{ path: 'path to the file to read' }],
    execute,
};
