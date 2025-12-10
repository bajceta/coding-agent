import type { Tool, ToolCall, Tools } from './interfaces.ts';
import type { Parser } from './parser.ts';

let tools: Tools = {};

export class PlainTextParser implements Parser {
    parseToolCalls(responseText: string): ToolCall[] {
        const toolCalls: ToolCall[] = [];
        const toolCallRegex = /tool_call: ?(\w+)\n([\s\S]*?)end_tool_call/g;
        let match;

        while ((match = toolCallRegex.exec(responseText)) !== null) {
            const args = this.extractArgs(match[2]);
            const toolCall: ToolCall = {
                name: match[1],
                arguments: {},
            };

            const tool = tools[toolCall.name];
            if (tool) {
                tool.arguments.forEach((arg) => {
                    Object.keys(arg).forEach((name) => {
                        const arg = args.find((a) => a.name === name);
                        if (arg) {
                            toolCall.arguments[name] = arg.value;
                        }
                    });
                });
            } else {
                console.error('unknown tool : ' + toolCall.name);
            }

            toolCalls.push(toolCall);
        }

        return toolCalls;
    }

    extractArgs(rawArgs: string): { name: string; value: string }[] {
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

    toolPrompt(tools: Tools): string {
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

    setTools(_tools: Tools): void {
        tools = _tools;
    }
}

function toolDefinitionToText(def: Tool): string {
    const args = [];
    Object.entries(def.arguments).forEach(([name, value]) => args.push(name + ':' + value));

    const result = `
tool_name: ${def.name}
description: ${def.description}
arguments:
${args.join('\n')}
`;
    return result;
}
