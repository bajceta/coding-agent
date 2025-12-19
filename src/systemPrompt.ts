import type { Tools } from './interfaces.ts';
import fs from 'fs';

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

    if (rulesFile && fs.existsSync(rulesFile)) {
        const rulesContent = fs.readFileSync(rulesFile, 'utf8');
        prompt += `\n${rulesContent}\n`;
    }
    return prompt;
}

export { systemPrompt };
