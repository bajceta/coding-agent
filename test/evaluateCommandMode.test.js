const { evaluateCommandMode } = require('../src/evaluateCommand');

const readCommands = [
    'git diff',
    'git status',
    'git log',
    'git show',
    'git blame',
    'git branch',
    'git tag',
    'git stash',
    'git remote',
    'cat file.txt',
    'head file.txt',
    'tail file.txt',
    'less file.txt',
    'grep "pattern" file.txt',
    'ls -la',
    'find . -name "*.js"',
    'find . -type f',
    'pwd',
    'date',
    'who',
    'env',
    'hostname',
    'ls',
    'node --version',
    'node --help',
    'ansible --version',
];

const writeCommands = [
    'echo "text" > file.txt',
    'echo "text" >> file.txt',
    'cat >> file.txt',
    'mkdir -p newdir',
    'mkdir -p',
    'tee "text" file.txt',
    'sed -i "s/old/new/" file.txt',
    'awk -i "s/old/new/" file.txt',
    'touch',
    'rm',
];

const runCommands = [
    'npm install',
    'git commit',
    'echo text',
    '',
    '   ',
    'curl https://example.com',
    'cat',
    '-h',
];

describe('evaluateCommandMode', () => {
    describe('Read mode commands', () => {
        readCommands.forEach((command) => {
            test(`"${command}" should be read mode`, () => {
                expect(evaluateCommandMode(command)).toBe('read');
            });
        });
    });

    describe('Write mode commands', () => {
        writeCommands.forEach((command) => {
            test(`"${command}" should be write mode`, () => {
                expect(evaluateCommandMode(command)).toBe('write');
            });
        });
    });

    describe('Run mode commands', () => {
        runCommands.forEach((command) => {
            test(`"${command}" should be run mode`, () => {
                expect(evaluateCommandMode(command)).toBe('run');
            });
        });
    });
});
