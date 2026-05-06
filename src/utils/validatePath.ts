import path from 'path';
import os from 'os';

/**
 * Validates that a path is within the current working directory.
 * Returns the resolved path if valid, or an error message if invalid.
 */
export function validatePath(_path: string): { resolvedPath: string } | { error: string } {
    // If path starts with `~`, replace it with the home directory
    let normalizedPath = _path;
    if (_path.startsWith('~')) {
        const homeDir = os.homedir();
        normalizedPath = _path.replace(/^~/, homeDir);
    }

    const cwd = process.cwd();
    const resolvedPath = path.resolve(normalizedPath);

    // Check if path is within current working directory
    if (!resolvedPath.startsWith(cwd + path.sep) && resolvedPath !== cwd) {
        return { error: 'Path must be within the current working directory' };
    }

    return { resolvedPath };
}
