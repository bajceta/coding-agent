import runCommand from './runCommand.ts';
import type { ExecuteResult } from '../interfaces.ts';

async function execute(filename?: string): Promise<ExecuteResult> {
    if (filename) {
        return await runCommand.execute(`rg --files -g "*${filename}*"`);
    } else {
        // Return all files
        return await runCommand.execute(`rg --files`);
    }
}

export default {
    description: 'Find files in current project',
    arguments: [
        {
            filename: 'optional: partial or full filename to search for',
        },
    ],
    execute,
    enabled: true,
    safe: true,
};
