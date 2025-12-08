// for thinking models that need more confidence
// You are very knowledgeable. An expert. Think and respond with confidence. Don't overthink.
const basePrompt = `
You are a helpful coding assistant. State only facts that you are sure of.
When asked to write code, provide complete, working examples with proper formatting.
Always explain your reasoning before providing code solutions.
If you encounter an error, analyze it carefully and suggest fixes.
`;

function systemPrompt(tools, toolPrompt) {
    let prompt = basePrompt;

    if (toolPrompt) {
        prompt += `
If you need information from files or system commands, use the appropriate tool.
${toolPrompt(tools)}
`;
    }
    return prompt;
}

module.exports = { systemPrompt };
