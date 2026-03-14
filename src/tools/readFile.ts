import fs from 'fs';
import { validatePath } from '../utils/validatePath.ts';

interface ExecuteResult {
    success: boolean;
    content: string | null;
    error: string | null;
}

async function execute(_path: string, offset?: number, max?: number): Promise<ExecuteResult> {
    try {
        const pathValidation = validatePath(_path);
        if ('error' in pathValidation) {
            return {
                success: false,
                content: null,
                error: pathValidation.error,
            };
        }
        const resolvedPath = pathValidation.resolvedPath;

        // Read file content
        const content = await fs.promises.readFile(resolvedPath, 'utf8');

        // Split into lines
        const lines = content.split('\n');

        // Calculate actual start and end positions
        let startIndex = 0;
        let endIndex = lines.length;
        if (offset !== undefined && offset >= 0) {
            startIndex = Math.min(offset, lines.length);
            if (max !== undefined && max > 0) {
                endIndex = Math.min(startIndex + max, lines.length);
            }
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
