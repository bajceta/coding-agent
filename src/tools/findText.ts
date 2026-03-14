import runCommand from './runCommand.ts';
import type { ExecuteResult } from '../interfaces.ts';

const MAX_OUTPUT_LENGTH = 1000;

async function execute(text: string, path: string, fileType?: string): Promise<ExecuteResult> {
    if (!path) {
        path = '.';
    }

    let command = `rg '${text}' '${path}'`;
    if (fileType) {
        command += ` -t '${fileType}'`;
    }

    const result = await runCommand.execute(command);

    if (result.success && result.content) {
        if (result.content.length > MAX_OUTPUT_LENGTH) {
            const truncated = result.content.substring(0, MAX_OUTPUT_LENGTH);
            const lastNewline = truncated.lastIndexOf('\n');
            const cutPoint = lastNewline > -1 ? lastNewline : MAX_OUTPUT_LENGTH;
            result.content =
                result.content.substring(0, cutPoint) +
                '\n\n[... output truncated - ' +
                (result.content.length - cutPoint) +
                ' more characters]';
        }
    }

    return result;
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
