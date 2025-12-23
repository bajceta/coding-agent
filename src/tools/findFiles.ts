import runCommand from './runCommand.ts';
import type { ExecuteResult } from '../interfaces.ts';

async function execute(): Promise<ExecuteResult> {
    return await runCommand.execute(`rg --files`);
}

export default {
    description: 'Find files in current project',
    arguments: [],
    execute,
    enabled: true,
    safe: true,
};
