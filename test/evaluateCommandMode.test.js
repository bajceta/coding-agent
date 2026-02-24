const { evaluateCommandMode } = require('../src/evaluateCommand');

describe('evaluateCommandMode - Current Behavior', () => {
    describe('Write detection (redirection operators)', () => {
        test('echo with > should be write mode', () => {
            expect(evaluateCommandMode('echo "text" > file.txt')).toBe('write');
        });

        test('echo with >> should be write mode', () => {
            expect(evaluateCommandMode('echo "text" >> file.txt')).toBe('write');
        });

        test('cat with >> should be write mode', () => {
            expect(evaluateCommandMode('cat >> file.txt')).toBe('write');
        });

        test('tee command is currently run mode (regex bug)', () => {
            expect(evaluateCommandMode('tee "text" file.txt')).toBe('run');
        });

        test('sed -i is currently run mode (regex bug)', () => {
            expect(evaluateCommandMode('sed -i "s/old/new/" file.txt')).toBe('run');
        });

        test('awk -i is currently run mode (regex bug)', () => {
            expect(evaluateCommandMode('awk -i "s/old/new/" file.txt')).toBe('run');
        });
    });

    describe('Write commands with specific patterns', () => {
        test('mkdir -p should be write mode', () => {
            expect(evaluateCommandMode('mkdir -p ')).toBe('write');
        });

        test('mkdir -p without trailing space should also be write mode', () => {
            expect(evaluateCommandMode('mkdir -p')).toBe('write');
        });

        test('mkdir without -p should be run mode', () => {
            expect(evaluateCommandMode('mkdir newdir')).toBe('run');
        });
    });

    describe('Read detection - find command', () => {
        test('find with -name should be read mode', () => {
            expect(evaluateCommandMode('find . -name "*.js"')).toBe('read');
        });

        test('find with -type should be read mode', () => {
            expect(evaluateCommandMode('find . -type f')).toBe('read');
        });
    });

    describe('Read commands (working cases)', () => {
        test('cat with file argument should be read mode', () => {
            // This works because the pattern /^cat\s/ matches "cat " (with space)
            // and then file.txt is just ignored
            expect(evaluateCommandMode('cat file.txt')).toBe('read');
        });

        test('head with file should be read mode', () => {
            expect(evaluateCommandMode('head file.txt')).toBe('read');
        });

        test('tail with file should be read mode', () => {
            expect(evaluateCommandMode('tail file.txt')).toBe('read');
        });

        test('less with file should be read mode', () => {
            expect(evaluateCommandMode('less file.txt')).toBe('read');
        });

        test('grep pattern file should be read mode', () => {
            expect(evaluateCommandMode('grep "pattern" file.txt')).toBe('read');
        });
    });

    describe('Run mode (default)', () => {
        test('npm install should be run mode', () => {
            expect(evaluateCommandMode('npm install')).toBe('run');
        });

        test('git diff should be read mode', () => {
            expect(evaluateCommandMode('git diff')).toBe('read');
        });

        test('git status should be read mode', () => {
            expect(evaluateCommandMode('git status')).toBe('read');
        });

        test('git log should be read mode', () => {
            expect(evaluateCommandMode('git log')).toBe('read');
        });

        test('git show should be read mode', () => {
            expect(evaluateCommandMode('git show')).toBe('read');
        });

        test('git blame should be read mode', () => {
            expect(evaluateCommandMode('git blame')).toBe('read');
        });

        test('git branch should be read mode', () => {
            expect(evaluateCommandMode('git branch')).toBe('read');
        });

        test('git tag should be read mode', () => {
            expect(evaluateCommandMode('git tag')).toBe('read');
        });

        test('git stash should be read mode', () => {
            expect(evaluateCommandMode('git stash')).toBe('read');
        });

        test('git remote should be read mode', () => {
            expect(evaluateCommandMode('git remote')).toBe('read');
        });

        test('cat alone should be run mode', () => {
            expect(evaluateCommandMode('cat')).toBe('run');
        });

        test('ls alone should be run mode', () => {
            expect(evaluateCommandMode('ls')).toBe('run');
        });

        test('pwd should be read mode', () => {
            expect(evaluateCommandMode('pwd')).toBe('read');
        });

        test('date should be read mode', () => {
            expect(evaluateCommandMode('date')).toBe('read');
        });

        test('who should be read mode', () => {
            expect(evaluateCommandMode('who')).toBe('read');
        });

        test('env should be read mode', () => {
            expect(evaluateCommandMode('env')).toBe('read');
        });

        test('hostname should be read mode', () => {
            expect(evaluateCommandMode('hostname')).toBe('read');
        });

        test('echo without redirect should be run mode', () => {
            expect(evaluateCommandMode('echo text')).toBe('run');
        });

        test('empty string should default to run mode', () => {
            expect(evaluateCommandMode('')).toBe('run');
        });

        test('whitespace only should be run mode', () => {
            expect(evaluateCommandMode('   ')).toBe('run');
        });

        test('curl without -s should be run mode', () => {
            expect(evaluateCommandMode('curl https://example.com')).toBe('run');
        });

        test('touch should be run mode (needs space after)', () => {
            expect(evaluateCommandMode('touch')).toBe('run');
        });

        test('rm should be run mode (needs more)', () => {
            expect(evaluateCommandMode('rm')).toBe('run');
        });
    });
});
