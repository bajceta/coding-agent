import runCommand from './runCommand.ts';
import type { ExecuteResult } from '../interfaces.ts';

async function execute(url: string): Promise<ExecuteResult> {
    let command = `curl -sL "${url}" | html-to-markdown -f djot`;
    return runCommand.execute(command);
}

export default {
    description: 'Fetch  webpage',
    arguments: [{ url: 'url' }],
    execute,
    enabled: true,
    safe: true,
};
