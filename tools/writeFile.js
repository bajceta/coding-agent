const fs = require('fs').promises;
const path = require('path');

async function execute(_path, content) {
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

        const dir = path.dirname(resolvedPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(resolvedPath, content, 'utf8');

        return {
            success: true,
            content: `Successfully wrote to ${resolvedPath}`,
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
    description: 'Write content to a file.',
    arguments: [
        { path: 'path to the file to write' },
        { content: 'contents of the file to write' },
    ],
    execute,
};
