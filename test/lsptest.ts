#!/usr/bin/env node

import lsptool from '../src/tools/lsp.ts';

console.log('LSP Tool Info:');
console.log(lsptool);

// Test with a more robust approach - try to get the hover information
try {
    let result = await lsptool.execute('hover', './index.ts', 113, 18); // 0-based indexing: line 113, char 17
    console.log('Hover Result:');
    console.log(result);
    setTimeout(async () => {
        result = await lsptool.execute('definition', './index.ts', 113, 18); // 0-based indexing: line 113, char 17
        console.log('Hover Result:');
        console.log(result);
        result = await lsptool.execute('hover', './index.ts', 113, 18); // 0-based indexing: line 113, char 17
        console.log('Hover Result:');
        console.log(result);
    }, 2000);
} catch (error) {
    console.error('Error executing LSP hover:', error);
}

// Cleanup
await lsptool.cleanup();
