import path from 'path';
import runCommand from './runCommand.ts';
import { validatePath } from '../utils/validatePath.ts';
import type { ExecuteResult } from '../interfaces.ts';

async function execute(_path: string, patch: string): Promise<ExecuteResult> {
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

        // Write the patch to a temporary file
        const patchFilePath = path.resolve(cwd, `.patch_${Date.now()}.txt`);
        await import('fs').then((fs) => fs.promises.writeFile(patchFilePath, patch, 'utf8'));

        // Apply the patch using the patch command
        // -p1 preserves the path structure from the patch file
        const result = await runCommand.execute(`patch -i '${patchFilePath}' ${resolvedPath} `);

        // Clean up the temporary patch file
        await import('fs').then((fs) => fs.promises.unlink(patchFilePath).catch(() => {}));

        if (result.success) {
            return {
                success: true,
                content: `Successfully applied patch to ${resolvedPath}`,
                error: null,
            };
        } else {
            return {
                success: false,
                content: null,
                error: `Failed to apply patch: ${result.error || result.content}`,
            };
        }
    } catch (error) {
        return {
            success: false,
            content: null,
            error: `Error applying patch: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

// Export module
export default {
    description: 'Apply a universal patch to a file',
    arguments: [
        { path: 'path to the file to patch' },
        { patch: 'patch content in unified diff format' },
    ],
    execute,
    enabled: false,
    safe: false,
};
