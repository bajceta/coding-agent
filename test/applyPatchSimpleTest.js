#!/usr/bin/env node

import tool from '../src/tools/applyPatch.ts';
import fs from 'fs';
import path from 'path';

const testDir = './test_temp';
const testFilePath = path.resolve(testDir, 'test.txt');

// Create a test directory and file
if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir);
}
fs.writeFileSync(testFilePath, 'Hello, World!\n', 'utf8');

// Test 1: Apply a valid patch
const patch = `--- test_temp/test.txt	2026-02-05 16:19:26.209188264 +0100
+++ test_temp/test.txt	2026-02-05 16:19:31.863282411 +0100
@@ -1 +1 @@
-Hello, World!
+Hello, Universe!
`;

console.log('Test 1: Applying a valid patch');
const result = await tool.execute(testFilePath, patch);
console.log('Result:', result);

if (result.success) {
    const content = fs.readFileSync(testFilePath, 'utf8');
    console.log('File content after patch:', content);
    console.assert(content === 'Hello, Universe!\n', 'Test 1 failed');
    console.log('Test 1 passed');
} else {
    console.error('Test 1 failed:', result.error);
}

// Test 2: Reject paths outside the working directory
console.log('\nTest 2: Rejecting paths outside the working directory');
const result2 = await tool.execute('/tmp/test.txt', patch);
console.log('Result:', result2);
console.assert(result2.success === false, 'Test 2 failed');
console.assert(
    result2.error.includes('Path must be within the current working directory'),
    'Test 2 failed',
);
console.log('Test 2 passed');

// Test 3: Handle invalid patches
console.log('\nTest 3: Handling invalid patches');
const result3 = await tool.execute(testFilePath, 'invalid patch content');
console.log('Result:', result3);
console.assert(result3.success === false, 'Test 3 failed');
console.assert(result3.error.includes('Failed to apply patch'), 'Test 3 failed');
console.log('Test 3 passed');

// Clean up the test directory
if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
}

console.log('\nAll tests passed');
