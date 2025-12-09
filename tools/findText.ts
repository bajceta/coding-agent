import runCommand from './runCommand.ts';

async function execute(text: string): Promise<ExecuteResult> {
    const result = await runCommand.execute(`ag '${text}'`);
    if (result.success) {
        return {
            success: true,
            content: result.content,
            error: null,
        };
    } else {
        return {
            success: false,
            content: null,
            error: result.error,
        };
    }
}

// Export module
export default {
    description: 'Finds text in current project',
    arguments: [{ text: 'text to find' }],
    execute,
};
