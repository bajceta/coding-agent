import path from 'path';

/**
 * Validates that a path is within the current working directory.
 * Returns the resolved path if valid, or an error message if invalid.
 */
export function validatePath(_path: string): { resolvedPath: string } | { error: string } {
    const cwd = process.cwd();
    const resolvedPath = path.resolve(_path);

    // Check if path is within current working directory
    if (!resolvedPath.startsWith(cwd + path.sep) && resolvedPath !== cwd) {
        return { error: 'Path must be within the current working directory' };
    }

    return { resolvedPath };
}
