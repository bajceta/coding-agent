import type { Tool, ToolCall, Tools } from './interfaces.ts';
import type { Parser } from './parser.ts';
 
let tools: Tools = {};
 
export class JSONParser implements Parser {
    parseToolCalls(responseText: string): ToolCall[] {
        const toolCalls: ToolCall[] = [];
        const jsonToolCallRegex =
             /(?:\{\s*"tool_call":\s*\{\s*"name": "\w*"[,\s]*"arguments": \{(?:\s*"\w*": "(?:\\"|[^"]|\\n)*"[,\s]*)+\}\s*\}\s*\})/g;
 
        let match;
        while ((match = jsonToolCallRegex.exec(responseText)) !== null) {
            let jsonString = match[0];
            try {
                const parsed = JSON.parse(jsonString);
                if (parsed.tool_call && parsed.tool_call.name) {
                    const toolCall: ToolCall = {
                        name: parsed.tool_call.name,
                        arguments: parsed.tool_call.arguments || {},
                    };
                    toolCalls.push(toolCall);
                }
            } catch (e) {
                console.error('failed parsing ' + jsonString, e);
                continue;
            }
        }
 
        return toolCalls;
    }
 
    toolPrompt(tools: Tools): string {
        // JSON format example
        const jsonExample = `{
  "tool_call": {
    "name": "toolName",
    "arguments": {
      "argument1": "value",
      "argument2": "longer value\\nnnext line "
    }
  }
}`;
 
        return `
When you need to use tools, respond using this format:
${jsonExample}
 
IMPORTANT JSON Tool Calling Rules:
- Use valid JSON syntax
- The tool_call object must contain name and arguments properties
- Arguments should be key-value pairs
- Multiline values should use the \\n, not newline.
 
If you need data, do a tool call and wait for response.
 
Example: list files in current folder with ls.
{
  "tool_call": {
    "name": "runCommand",
    "arguments": {
      "command": "ls"
    }
  }
}
Example: find text "treasure" in current folder
{
  "tool_call": {
    "name": "findText",
    "arguments": {
      "path": "./",
      "text": "treasure"
    }
  }
}
Example: write content to file 'demo.js'
{
  "tool_call": {
    "name": "writeFile",
    "arguments": {
      "path": "demo.js",
      "content": "function helloWorld(){\\n   console.log(\\"hello world\\");\\n}\\nhelloWorld();"
    }
  }
}
 
You have access to following tools:
${Object.values(tools).map(toolDefinitionToText).join('\n')}
`;
    }
 
    setTools(_tools: Tools): void {
        tools = _tools;
    }
}
 
function toolDefinitionToText(def: Tool): string {
    const args: string[] = [];
    for (const argName in def.arguments) {
        args.push(`${argName}:${def.arguments[argName]}`);
    }
 
    const result = `
tool_name: ${def.name}
description: ${def.description}
arguments:
${args.join('\n')}
`;
    return result;
}
