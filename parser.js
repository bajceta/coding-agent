const toolCallRegex = /"tool_call"\s*:\s*(\{[^}]*\}})/g;

function extractToolCallRaw(responseText) {
    const toolCalls = [];
    let match;
    while ((match = toolCallRegex.exec(responseText)) !== null) {
        const toolCallJson = match[1];
        toolCalls.push(toolCallJson);
    }
    return toolCalls;
}

function parseToolCalls(responseText) {
    if (!responseText || typeof responseText !== 'string') {
        return [];
    }

    const rawToolCalls = extractToolCallRaw(responseText);
    const toolCalls = [];

    rawToolCalls.forEach(json => {
        try {

            const parsedToolCall = JSON.parse(json);

            // Validate structure
            if (parsedToolCall.name && parsedToolCall.arguments !== undefined) {
                toolCalls.push({
                    name: parsedToolCall.name,
                    arguments: parsedToolCall.arguments || {}
                });
            }

        } catch (e) {
            console.error('Error parsing tool call:', e.message);
            // Skip this malformed match
        }
    });

    return toolCalls;
}

module.exports = { parseToolCalls, extractToolCallRaw };
