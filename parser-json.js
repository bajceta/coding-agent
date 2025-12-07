"use strict";

//const jsonToolCallRegex = /(\{[^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*\})/g
//const jsonToolCallRegex = /(?:\{\s*"tool_call":\s*\{\s*"name": "\w*"[,\s]*"arguments": \{(?:\s*"\w*": "(?:\\"|[^"]|\\n)*"[,\s]*)+\}\s*\}\s*\})/g
const jsonToolCallRegex = /(?:\{\s*"tool_call":\s*\{\s*"name": "\w*"[,\s]*"arguments": \{(?:\s*"\w*": "(?:\\"|[^"]|\\n)*"[,\s]*)+\}\s*\}\s*\})/g
const tools = [];

function extractToolCallRaw(responseText) {
    const toolCalls = [];

    // Look for JSON tool call patterns
    let match;
    while ((match = jsonToolCallRegex.exec(responseText)) !== null) {
        let jsonString = match[0];
        try {
            const parsed = JSON.parse(jsonString);
            if (parsed.tool_call && parsed.tool_call.name) {
                toolCalls.push({
                    name: parsed.tool_call.name,
                    arguments: parsed.tool_call.arguments
                });
            }
        } catch (e) {
            console.error("failed parsing " + jsonString, e);
            continue;
        }
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
        const argsObj=raw.arguments;
        // For JSON parser, we need to parse the arguments string back into an object
        try {
            // Convert object to array of values in order matching tool definition
            if (tools[toolCall.name] && tools[toolCall.name].arguments) {
                const toolArgs = tools[toolCall.name].arguments;
                for (const argDef of toolArgs) {
                    const argName = Object.keys(argDef)[0];
                    if (argsObj[argName] !== undefined) {
                        toolCall.arguments.push(argsObj[argName]);
                    } else {
                        toolCall.arguments.push('');
                    }
                }
            } else {
                // If we can't find the tool definition, add all arguments as strings
                for (const [key, value] of Object.entries(argsObj)) {
                    toolCall.arguments.push(value);
                }
            }
        } catch (e) {
            console.error("Error parsing JSON arguments:", e.message);
            toolCall.arguments = [];
        }

        toolCalls.push(toolCall);
    }

    return toolCalls;
}

function setTools(_tools) {
    Object.assign(tools, _tools);
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
${toolDefinitions.map(toolDefinitionToText).join('\n')}
`;
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
`;
    return result;
}

module.exports = { setTools, extractToolCallRaw, parseToolCalls, toolPrompt };
