#!/usr/bin/env node

import lsptool from '../src/tools/lsp.ts';
import Log from '../src/log.ts';

Log.setLogLevel('debug');
console.log('LSP Tool Info:');
console.log(lsptool);

// Test with a more robust approach - try to get the hover information
try {
    let result = await lsptool.execute('didOpen', './index.ts', 113, 18); // 0-based indexing: line 113, char 17
    console.log('Hover Result:');
    console.log(result);
    result = await lsptool.execute('hover', './index.ts', 113, 18); // 0-based indexing: line 113, char 17
    console.log('Hover Result:');
    console.log(result);
} catch (error) {
    console.error('Error executing LSP hover:', error);
}

// Cleanup
await lsptool.cleanup();
