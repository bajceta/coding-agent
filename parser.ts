import type { Tool, ToolCall, Tools } from './interfaces.ts';

let tools: Tools = {};

function extractToolCallRaw(responseText): { name: string; arguments: string }[] {
    const toolCallRegex = /tool_call: ?(\w+)\n([\s\S]*?)end_tool_call/g;
    const toolCalls = [];
    let match;
    while ((match = toolCallRegex.exec(responseText)) !== null) {
        const toolcall = {
            name: match[1],
            arguments: match[2],
        };
        toolCalls.push(toolcall);
    }
    return toolCalls;
}

function extractArgs(rawArgs): { name: string; value: string }[] {
    const argumentsRegex = /(\w+.):([\s\S]*?)ENDARG/g;
    const args = [];
    let match;
    while ((match = argumentsRegex.exec(rawArgs)) !== null) {
        const arg = {
            name: match[1],
            value: match[2],
        };
        args.push(arg);
    }
    return args;
}

function parseToolCalls(responseText): ToolCall[] {
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
            for (var i = 0; i < Object.keys(tool.arguments).length; i++) {
                toolCall.arguments.push(args[i].value);
            }
        } else {
            console.error('unknown tool : ' + toolCall.name);
        }
        toolCalls.push(toolCall);
    }
    return toolCalls;
}

function setTools(_tools) {
    tools = _tools;
}

function toolPrompt(tools: Tools) {
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
 - tool call starts with "tool_call: toolName"
 - tool call must end with "end_tool_call"
 - argument must starts with "argumentName:"
 - argument must ends with "ENDARG"

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
${Object.values(tools).map(toolDefinitionToText).join('\n')}
`;
}

function toolDefinitionToText(def: Tool) {
    const args = [];
    Object.entries(def.arguments).forEach(([name, value]) =>
        args.push(name + ':' + value)
   );

    const result = `
tool_name: ${def.name}
description: ${def.description}
arguments:
${args.join('\n')}
`;
    return result;
}

export { setTools, extractToolCallRaw, parseToolCalls, toolPrompt };
