import fs from 'fs';
import path from 'path';
import { validatePath } from '../utils/validatePath.ts';
import type { ExecuteResult } from '../interfaces.ts';

async function execute(_path: string, content: string): Promise<ExecuteResult> {
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

        const dir = path.dirname(resolvedPath);
        await fs.promises.mkdir(dir, { recursive: true });

        if (typeof content === 'string') await fs.promises.writeFile(resolvedPath, content, 'utf8');
        else await fs.promises.writeFile(resolvedPath, JSON.stringify(content), 'utf8');
        return {
            success: true,
            content: 'ok',
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
    arguments: [{ path: 'path' }, { content: 'content' }],
    execute,
    enabled: true,
};
