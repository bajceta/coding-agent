const fs = require('fs');
const path = require('path');

function loadTools() {
    const toolsDir = path.join(__dirname, 'tools');
    const tools = {};

    if (fs.existsSync(toolsDir)) {
        const files = fs.readdirSync(toolsDir);
        for (const file of files) {
            if (file.endsWith('.js') && file !== 'index.js') {
                const toolName = path.basename(file, '.js');
                try {
                    const toolModule = require(path.join(toolsDir, file));
                    toolModule.name = toolName;
                    tools[toolName] = toolModule;
                } catch (error) {
                    console.error(`Failed to load tool ${toolName}:`, error.message);
                }
            }
        }
    }

    return tools;
}

module.exports = { loadTools };
