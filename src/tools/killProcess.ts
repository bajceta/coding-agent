import type { ExecuteResult } from '../interfaces.ts';
import runCommandTool from './runCommand.ts';
import Log from '../log.ts';
const log = Log.get('killProcess');

async function execute(processId: string): Promise<ExecuteResult> {
    try {
        return await runCommandTool.killProcess(processId);
    } catch (error) {
        return {
            success: false,
            content: '',
            error: error.message,
        };
    }
}

// Export module
export default {
    description: `Stop a running command by process ID.
    Use this tool to kill a process that was started with the runCommand tool.
    `,
    arguments: [{ processId: 'The process ID of the running command to kill' }],
    execute,
    enabled: true,
    safe: false,
};
