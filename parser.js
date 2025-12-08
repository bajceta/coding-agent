let tools = [];

function extractToolCallRaw(responseText) {
    const toolCallRegex = /tool_call: ?(\w+)\n([\s\S]*?)end_tool_call/g
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

function extractArgs(rawArgs) {
    const argumentsRegex = /(\w+.):([\s\S]*?)ENDARG/g
    const args = [];
    let match;
    while ((match = argumentsRegex.exec(rawArgs)) !== null) {
        const arg = {
            name: match[1],
            value: match[2]
        }
        args.push(arg);
    }
    return args;
}

function parseToolCalls(responseText) {
    const toolCalls = [];
    const rawCalls = extractToolCallRaw(responseText);
    for (const raw of rawCalls) {
        const args = extractArgs(raw.arguments);
        const toolCall = {
            name: raw.name,
            arguments: [],
        };
        const tool = tools[toolCall.name];
        if (tool) {
            for (var i = 0; i < tool.arguments.length; i++) {
                toolCall.arguments.push(args[i].value);
            }
        } else {
            console.error("unknown tool : " + toolCall.name);
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
argument1:valueENDARG
argument2:longer
valueENDARG
end_tool_call

IMPORTANT Tool calling argument rules:
 - names are followed by a column
 - never place values in quotes
 - format of arguments is strictly name:valueENDARG

If you need data, do a tool call and wait for response.

Example: list files in current folder with ls.
tool_call: runCommand
command:lsENDARG
end_tool_call
Example: find text "treasure" in current folder
tool_call: findText
path:./ENDARG
text:treasureENDARG
Example: write content to file 'demo.js'
tool_call:writeFile
path:demo.jsENDARG
content:function helloWorld(){
   console.log("hello world");
}
helloWorld();ENDARG
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

module.exports = { setTools, extractToolCallRaw, extractArgs,  parseToolCalls, toolPrompt };
