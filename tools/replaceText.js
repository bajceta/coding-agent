const fs = require('fs').promises;
const path = require('path');

async function execute(_path, oldText, newText) {
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
        const newContent = content.split(oldText).join(newText);
        await fs.writeFile(resolvedPath, newContent, 'utf8');

        return {
            success: true,
            content: `Successfully replaced text in ${resolvedPath}`,
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
    description: 'Replace partial text in a file. For complete file use writeFile instead.',
    arguments: [
        { path: 'path to the file to modify' },
        { oldText: 'text to be replaced' },
        { newText: 'replacement text' },
    ],
    execute,
};
