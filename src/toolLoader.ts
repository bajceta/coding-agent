import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Tool, Tools } from './interfaces.ts';

async function loadTools(): Promise<Tools> {
    const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
    const __dirname = path.dirname(__filename);
    const toolsDir = path.join(__dirname, 'tools');
    const tools: Record<string, Tool> = {};

    if (fs.existsSync(toolsDir)) {
        const files = fs.readdirSync(toolsDir);
        for (const file of files) {
            if (file.endsWith('.ts') && file !== 'index.ts') {
                const toolName = path.basename(file, '.ts');
                try {
                    const toolModule = await import(path.join(toolsDir, file));
                    const tool = {
                        name: toolName,
                        description: toolModule.default.description,
                        arguments: toolModule.default.arguments,
                        execute: toolModule.default.execute,
                    };
                    tools[toolName] = tool;
                } catch (error) {
                    console.error(`Failed to load tool ${toolName}:`, error.message);
                }
            }
        }
    }

    return tools;
}

export { loadTools };
