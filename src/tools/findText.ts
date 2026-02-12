import runCommand from './runCommand.ts';
import type { ExecuteResult } from '../interfaces.ts';

async function execute(text: string, path: string, fileType?: string): Promise<ExecuteResult> {
    if (!path) {
        path = '.';
    }

    let command = `rg '${text}' '${path}'`;
    if (fileType) {
        command += ` -t '${fileType}'`;
    }

    return await runCommand.execute(command);
}

// Export module
export default {
    description: 'Greps for text in current project',
    arguments: [
        { text: 'text to find' },
        { path: 'filepath "." for current folder, "somefile" to search in that file only' },
        { fileType: 'optional file type to search (e.g., "ts", "json", "md")' },
    ],
    execute,
    enabled: true,
    safe: true,
};
