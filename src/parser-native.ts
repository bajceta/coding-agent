import type { Parser } from './parser.ts';
import type { ToolCall, Message } from './interfaces.ts';
import type { Tools, OpenaiToolDef } from './interfaces.ts';
import { getConfig } from './config.ts';

export class NativeParser implements Parser {
    parseToolCalls(msg: Message): ToolCall[] {
        const toolcalls = [];
        if (msg.tool_calls) {
            msg.tool_calls.forEach((_toolcall) => {
                console.log(_toolcall);
                const toolcall: ToolCall = {
                    id: _toolcall.id,
                    name: _toolcall.function.name,
                    arguments: JSON.parse(_toolcall.function.arguments),
                };
                toolcalls.push(toolcall);
            });
        }
        return toolcalls;
    }

    toolPrompt(_) {
        return '';
    }
}

export function openaiTools(_tools: Tools): OpenaiToolDef[] {
    const tools = [];

    if (getConfig().parserType != 'native') return tools;
    for (const [toolName, tool] of Object.entries(_tools)) {
        const properties = {};
        const required = [];

        for (const key of Object.keys(tool.arguments || {})) {
            properties[key] = { type: 'string' };
            required.push(key);
        }

        tools.push({
            type: 'function',
            function: {
                name: toolName,
                description: tool.description,
                parameters: {
                    type: 'object',
                    properties,
                    required,
                },
            },
        });
    }

    return tools;
}
