const runCommand = require('./runCommand');

async function findText(text) {
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

module.exports = {
    description: 'Finds text in current project',
    arguments: [{ text: 'text to find' }],
    execute: findText,
};
