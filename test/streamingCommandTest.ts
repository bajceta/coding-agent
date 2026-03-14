import { spawn } from 'child_process';
import eventBus from '../src/eventBus.ts';

// Test simple command with streaming
const testCommand = 'for i in 1 2 3 4 5 6 7 8 9 10; do echo "Step $i"; sleep 1; done';

console.log('Testing streaming command execution...');
console.log('Command:', testCommand);
console.log('');

// Simulate what the runCommand tool does
let outputBuffer = '';
let lastSendTime = Date.now();
const processId = 'test_123';

const proc = spawn('bash', ['-c', testCommand], { shell: '/bin/bash' });

proc.stdout.on('data', (data) => {
    const dataStr = data.toString();
    outputBuffer += dataStr;
    console.log(`Received output: ${dataStr.trim()}`);

    // Simulate 5 second check
    if (Date.now() - lastSendTime >= 5000) {
        console.log(`[5-second checkpoint] Accumulated output: ${outputBuffer.trim()}`);
        outputBuffer = '';
        lastSendTime = Date.now();
    }
});

proc.stderr.on('data', (data) => {
    console.error(`STDERR: ${data}`);
});

proc.on('exit', (code) => {
    if (outputBuffer) {
        console.log(`[Final] Remaining output: ${outputBuffer.trim()}`);
    }
    console.log(`Process exited with code ${code}`);
});

proc.on('error', (error) => {
    console.error(`Process error: ${error.message}`);
});
