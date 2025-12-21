#!/usr/bin/env node

import tool from '../src/tools/runCommand.ts';

console.log(tool);
const result = await tool.execute('ls ');
console.log(result);
