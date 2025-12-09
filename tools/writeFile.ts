import fs from 'fs';
import path from 'path';
import type { ExecuteResult } from '../interfaces.ts'
 
async function execute(_path: string, content: string): Promise<ExecuteResult> {
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
 
        // Write file content
        await fs.promises.writeFile(resolvedPath, content, 'utf8');
        return {
            success: true,
            content: null,
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
    description: 'Write content to a file',
    arguments: [
        { path: 'path to the file to write' },
        { content: 'content to write to the file' }
    ],
    execute,
};
