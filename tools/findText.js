const runCommand = require('./runCommand');

async function findText(text) {
    return await runCommand.execute(`ag '${text}'`);
}

module.exports = {
    description: 'Finds text in current project',
    arguments: [{ text: 'text to find' }],
    execute: findText,
};
