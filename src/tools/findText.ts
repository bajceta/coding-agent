import runCommand from './runCommand.ts';
import type { ExecuteResult } from '../interfaces.ts';

async function execute(text: string): Promise<ExecuteResult> {
    return await runCommand.execute(`ag '${text}'`);
}

// Export module
export default {
    description: 'Greps for text in current project',
    arguments: [{ text: 'text to find' }],
    execute,
    enabled: true,
    safe: true,
};
