const toolCallRegex = /tool_call: (\w+)\n([\s\S]*?)end_tool_call/g
const argumentsRegex = /(.*\n)([\s\S]*)?/
const singleArg = /(.*):([\s\S]*)\n/

let tools = [];

function extractToolCallRaw(responseText) {
    const toolCalls = [];
    let match;
    while ((match = toolCallRegex.exec(responseText)) !== null) {
        const toolcall = {
            name: match[1],
            arguments: match[2]
        }
        toolCalls.push(toolcall);

    }
    return toolCalls;
}

function parseToolCalls(responseText) {
    const toolCalls = [];
    const rawCalls = extractToolCallRaw(responseText);
    for (const raw of rawCalls) {
        const toolCall = {
            name: raw.name,
            arguments: [],
        };

        const tool = tools[toolCall.name];
        if (tool) {
            let lines = raw.arguments;
            for (var i = 0; i < tool.arguments.length; i++) {
                if (i != (tool.arguments.length - 1)) {
                    const match = argumentsRegex.exec(lines);
                    toolCall.arguments.push(match[1]);
                    lines = match[2];
                } else {
                    toolCall.arguments.push(lines);
                }
            }
        } else {
            console.error("unknown tool : " + toolCall.name);
        }
        // remove argument name
        for (var i = 0; i < toolCall.arguments.length; i++) {
            const rawarg = toolCall.arguments[i];
            const match = singleArg.exec(rawarg);

            toolCall.arguments[i] = (match[2]);
        }
        toolCalls.push(toolCall);
    }
    return toolCalls;
}

function setTools(_tools) {
    tools = _tools;
}

module.exports = { setTools, extractToolCallRaw, parseToolCalls };
