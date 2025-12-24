import fs from 'fs';
import path from 'path';

interface ExecuteResult {
    success: boolean;
    content: string | null;
    error: string | null;
}

async function execute(_path: string, offset?: number, max?: number): Promise<ExecuteResult> {
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

        // Split into lines
        const lines = content.split('\n');

        // Calculate actual start and end positions
        let startIndex = 0;
        if (offset !== undefined && offset >= 0) {
            startIndex = Math.min(offset, lines.length);
        }

        let endIndex = lines.length;
        if (max !== undefined && max > 0) {
            endIndex = Math.min(startIndex + max, lines.length);
        } else if (offset !== undefined && offset >= 0) {
            // If no max specified but offset is given, read to end
            endIndex = lines.length;
        }

        // Extract the desired portion
        const selectedLines = lines.slice(startIndex, endIndex);
        const resultContent = selectedLines.join('\n');

        return {
            success: true,
            content: resultContent,
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
    description: 'Read the contents of a file, with optional offset and max lines',
    arguments: [
        { path: 'path to the file to read' },
        { offset: 'starting line number (0-based)' },
        { max: 'maximum number of lines to read' },
    ],
    execute,
    enabled: true,
    safe: true,
};
