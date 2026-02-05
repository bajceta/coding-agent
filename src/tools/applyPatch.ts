import path from 'path';
import runCommand from './runCommand.ts';
import type { ExecuteResult } from '../interfaces.ts';

async function execute(_path: string, patch: string): Promise<ExecuteResult> {
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

        // Write the patch to a temporary file
        const patchFilePath = path.resolve(cwd, `.patch_${Date.now()}.txt`);
        await import('fs').then((fs) => fs.promises.writeFile(patchFilePath, patch, 'utf8'));

        // Apply the patch using the patch command
        // -p1 preserves the path structure from the patch file
        const result = await runCommand.execute(`patch -p1 '${patchFilePath}'`);

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
    enabled: true,
    safe: false,
};
