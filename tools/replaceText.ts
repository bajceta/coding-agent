import fs from 'fs';
import path from 'path';
import type { ExecuteResult } from '../interfaces.ts';

async function execute(_path: string, oldText: string, newText: string): Promise<ExecuteResult> {
    try {
        const cwd = process.cwd();
        const resolvedPath = path.resolve(_path);

        // Check if path is within current working directory
        if (!resolvedPath.startsWith(cwd + path.sep) && resolvedPath !== cwd) {
            return {
                success: false,
                content: null,
                error: 'Path must be within the current working directory',
            };
        }

        const content = await fs.promises.readFile(resolvedPath, 'utf8');

        // Check if oldText exists in the content
        if (!content.includes(oldText)) {
            return {
                success: false,
                content: null,
                error: `Text "${oldText}" not found in file ${resolvedPath}`,
            };
        }

        const newContent = content.split(oldText).join(newText);
        await fs.promises.writeFile(resolvedPath, newContent, 'utf8');

        return {
            success: true,
            content: `Successfully replaced text in ${resolvedPath}`,
            error: null,
        };
    } catch (error) {
        return {
            success: false,
            content: null,
            error: error.message,
        };
    }
}

// Export module
export default {
    description: 'Replace partial text in a file. For complete file use writeFile instead.',
    arguments: [
        { path: 'path to the file to modify' },
        { oldText: 'text to be replaced' },
        { newText: 'replacement text' },
    ],
    execute,
};