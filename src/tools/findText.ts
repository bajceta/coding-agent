import runCommand from './runCommand.ts';
import type { ExecuteResult } from '../interfaces.ts';

async function execute(text: string, path: string): Promise<ExecuteResult> {
    if (!path) {
        path = '.';
    }
    return await runCommand.execute(`rg '${text}' '${path}'`);
}

// Export module
export default {
    description: 'Greps for text in current project',
    arguments: [
        { text: 'text to find' },
        { path: 'filepath "." for current folder, "somefile" to search in that file only' },
    ],
    execute,
    enabled: true,
    safe: true,
};
