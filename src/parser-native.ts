import type { Parser } from './parser.ts';
import type { ToolCall, Message } from './interfaces.ts';
import type { Tools, OpenaiToolDef } from './interfaces.ts';
import { getConfig } from './config.ts';
import Log from './log.ts';
const log = Log.get('parser-native');

export class NativeParser implements Parser {
    parseToolCalls(msg: Message): ToolCall[] {
        const toolcalls = [];
        if (msg.tool_calls) {
            msg.tool_calls.forEach((_toolcall) => {
                log.debug(_toolcall);
                const toolcall: ToolCall = {
                    id: _toolcall.id,
                    name: _toolcall.function.name,
                    arguments: {},
                };
                if (_toolcall.function.arguments) {
                    try {
                        toolcall.arguments = JSON.parse(_toolcall.function.arguments);
                    } catch (e) {
                        _toolcall.function.arguments = '';
                        log.error(e);
                    }
                } else {
                    _toolcall.function.arguments = '';
                }
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
        tool.arguments.forEach((argObj) => {
            const [name, description] = Object.entries(argObj)[0];
            properties[name] = { type: 'string', description };
            required.push(name);
        });

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
