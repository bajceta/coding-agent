import type { Tools } from './interfaces.ts';
import fs from 'fs';
import path from 'path';

function systemPrompt(
    tools: Tools,
    toolPrompt: (tools: Tools) => string,
    rulesFile?: string,
): string {
    const basePrompt = `
You are a helpful coding assistant. State only facts that you are sure of.
When asked to write code, provide complete, working examples with proper formatting.
Always explain your reasoning before providing code solutions.
If you encounter an error, analyze it carefully and suggest fixes.
`;

    let prompt = basePrompt;

    if (toolPrompt) {
        prompt += `
If you need information from files or system commands, use the appropriate tool.
${toolPrompt(tools)}
If the user rejects a tool, ask the user why.
`;
    }

    if (rulesFile) {
        const resolvedRulesPath = path.resolve(rulesFile);
        if (fs.existsSync(resolvedRulesPath)) {
            const rulesContent = fs.readFileSync(resolvedRulesPath, 'utf8');
            prompt += `\\n${rulesContent}\\n`;
        } else {
            console.error('Rules file does not exists' + resolvedRulesPath);
            process.exit(1);
        }
    }

    return prompt;
}

export { systemPrompt };
