#!/usr/bin/env node

import lsptool from '../src/tools/lsp.ts';

console.log(lsptool);
const result = await lsptool.execute('hover', './index.ts', 113, 17);
console.log(result);
await lsptool.cleanup();
