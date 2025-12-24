import runCommand from './runCommand.ts';
import path from 'path';
import type { ExecuteResult } from '../interfaces.ts';

async function execute(_path: string, command: string): Promise<ExecuteResult> {
    const cwd = process.cwd();
    const resolvedPath = path.resolve(_path);

    if (!resolvedPath.startsWith(cwd + path.sep) && resolvedPath !== cwd) {
        return {
            success: false,
            content: null,
            error: 'Path must be within the current working directory',
        };
    }

    return await runCommand.execute(`sed -i '${command}'  ${_path}`);
}

export default {
    description: "Replace text in file with sed -i 'command'  path",
    arguments: [
        { path: 'file to replace text on' },
        { command: 'search and replace block for sed command' },
    ],
    execute,
    enabled: false,
    safe: true,
};
