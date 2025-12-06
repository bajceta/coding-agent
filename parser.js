const toolCallRegex = /tool_call: ?(\w+)\n([\s\S]*?)end_tool_call/g
const argumentsRegex = /(.*\n)([\s\S]*)?/
const singleArg = /(.*): ?([\s\S]*)\n/

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
                    if (lines[0] == '"' && lines[lines.length - 1] == '"') {
                        lines.slice(1, -1);
                    }
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

function getToolDefinitions(tools) {
    const definitions = [];
    for (const [name, tool] of Object.entries(tools)) {
        if (tool.arguments && tool.description) {
            definitions.push({
                name: tool.name || name,
                description: tool.description,
                arguments: tool.arguments
            });
        }
    }
    return definitions;
}

function toolPrompt(tools) {
    const toolDefinitions = getToolDefinitions(tools);
    return `
When you need to use tools, respond using this format:
tool_call: toolName
argument1:value
argument2:longer
value
end_tool_call

IMPORTANT Tool calling argument rules:
 - names are followed by a column
 - never place values in quotes
 - format of arguments is strictly name:value, no space after the name:

If you need data, do a tool call and wait for response.

Example: list files in current folder with ls.
tool_call: runCommand
command:ls
end_tool_call
Example: find text "treasure" in current folder
tool_call: findText
path:./
text:treasure
Example: write content to file 'demo.js'
tool_call:writeFile
path:demo.js
content:function helloWorld(){
   console.log("hello world");
}
helloWorld();
end_tool_call

You have access to following tools:
${toolDefinitions.map(toolDefinitionToText).join('\n')}
`
}

function toolDefinitionToText(def) {
    const args = [];
    def.arguments.forEach(arg => {
        const entries = Object.entries(arg);
        args.push(entries[0][0] + ":" + entries[0][1]);
    });

    const result = `
tool_name: ${def.name}
description: ${def.description}
arguments:
${args.join('\n')}
`
    return result;
}

module.exports = { setTools, extractToolCallRaw, parseToolCalls, toolPrompt };
