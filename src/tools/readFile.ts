import fs from 'fs';
import path from 'path';

interface ExecuteResult {
    success: boolean;
    content: string | null;
    error: string | null;
}

async function execute(_path: string): Promise<ExecuteResult> {
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

        // Read file content
        const content = await fs.promises.readFile(resolvedPath, 'utf8');
        return {
            success: true,
            content,
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
    description: 'Read the contents of a file',
    arguments: [{ path: 'path to the file to read' }],
    execute,
};
