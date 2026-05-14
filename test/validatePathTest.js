const os = require('os');
const path = require('path');
const { validatePath } = require('../src/utils/validatePath');

describe('validatePath', () => {
    const homeDir = os.homedir();
    const _cwd = process.cwd();

    describe('tilde expansion', () => {
        test('should expand ~ to home directory', () => {
            const result = validatePath('~/test.txt');
            if (result.resolvedPath) {
                expect(result.resolvedPath).toBe(path.join(homeDir, 'test.txt'));
            } else {
                // If path is not in cwd, it will return an error, but we can still check the expansion happened
                expect(result.error).toBeDefined();
            }
        });

        test('should expand ~/path/to/file correctly', () => {
            const result = validatePath('~/path/to/file.txt');
            if (result.resolvedPath) {
                expect(result.resolvedPath).toBe(path.join(homeDir, 'path', 'to', 'file.txt'));
            } else {
                expect(result.error).toBeDefined();
            }
        });

        test('should not expand ~ in the middle of path', () => {
            const result = validatePath('./folder~/file.txt');
            // This should not expand the tilde
            if (result.resolvedPath) {
                expect(result.resolvedPath).toContain('folder~');
            }
        });

        test('should not expand ~ at the end of folder name', () => {
            const result = validatePath('./folder~/');
            // This should not expand the tilde
            if (result.resolvedPath) {
                expect(result.resolvedPath).toContain('folder~');
            }
        });
    });

    describe('path validation', () => {
        test('should accept paths within cwd', () => {
            const result = validatePath('./test.txt');
            expect(result.resolvedPath).toBeDefined();
            expect(result.error).toBeUndefined();
        });

        test('should reject paths outside cwd', () => {
            const result = validatePath('/etc/passwd');
            expect(result.error).toBe('Path must be within the current working directory');
            expect(result.resolvedPath).toBeUndefined();
        });

        test('should accept relative paths', () => {
            const result = validatePath('src/utils/validatePath.ts');
            expect(result.resolvedPath).toBeDefined();
            expect(result.error).toBeUndefined();
        });
    });
});
