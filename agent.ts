import LLM from './llm.ts';
import { systemPrompt } from './systemPrompt.ts';
import type { Config } from './config.ts';
import {
    parseToolCalls as parseToolCallsJson,
    setTools as setToolsJson,
    toolPrompt as toolPromptJson,
} from './parser-json.ts';
import { parseToolCalls, setTools, toolPrompt } from './parser.ts';
import Window from './window.ts';
import { loadTools } from './toolLoader.ts';
import type { Tool, Tools, ToolCall, ExecuteResult } from './interfaces.ts';
import { TerminalInputHandler } from './terminalInput.ts'; // Import the handler

interface LLMResponse {
    content: string;
    stats?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        model: string;
    };
}

class Agent {
    window: Window;
    llm: LLM;
    tools: Record<string, Tool>;
    parserType: string;
    parseToolCalls: (content: string) => ToolCall[];
    toolPrompt: (tools: Tools) => string;
    singleShot: boolean;
    messages: Array<{ role: string; content: string }>;
    config: Config;
    inputHandler: TerminalInputHandler;

    constructor(config: Config) {
        this.config = config;
        this.window = new Window();
        this.llm = new LLM(this.window.statusBar.updateState.bind(this.window.statusBar));
        this.tools = {};
        this.parseToolCalls = parseToolCalls;
        this.toolPrompt = toolPrompt;
        this.singleShot = false;
        this.messages = [];
        if (this.config.parserType === 'json') {
            this.parseToolCalls = parseToolCallsJson;
            this.toolPrompt = toolPromptJson;
        }
    }

    async init() {
        await this.loadTools();
        this.messages.push({
            role: 'system',
            content: systemPrompt(this.tools, this.toolPrompt),
        });

        this.inputHandler = new TerminalInputHandler(this);
        this.inputHandler.setup();
    }

    async loadTools() {
        const tools = await loadTools();
        this.tools = tools;
        setTools(this.tools);
        setToolsJson(this.tools);
        this.print(`Loaded ${Object.keys(this.tools).length} tools`);
    }

    async askForConfirmation(toolName: string, args: Record<string, any>): Promise<boolean> {
        return new Promise((resolve) => {
            this.print(`Execute ${toolName} with args: ${JSON.stringify(args)}? (y/n): `);
            process.stdin.once('data', (answer: string) => {
                const response = answer.trim();
                resolve(/^y(es)?$/i.test(response));
            });
        });
    }

    processInput(input: string) {
        if (input.toLowerCase() === 'exit') {
            this.print('\nGoodbye!\n');
            process.exit(0);
        }

        this.messages.push({
            role: 'user',
            content: input,
        });

        try {
            this.run();
        } catch (error) {
            console.error('Error:', error.message);
            console.error('Error:', error.stack);
            this.messages.push({
                role: 'assistant',
                content: `Error: ${error.message}`,
            });
        }
    }

    showUserPrompt() {
        this.print('\n\x1b[34mUser: \x1b[0m');
    }

    async askQuestion(question: string) {
        this.print('\nQuestion: ' + question);
        this.singleShot = true;
        this.messages.push({
            role: 'user',
            content: question,
        });

        await this.run();
    }

    async processToolCall(toolcall: ToolCall): Promise<string> {
        try {
            const toolName = toolcall.name;
            const args = toolcall.arguments || {};
            const tool = this.tools[toolName];
            if (!tool) {
                throw new Error(`Tool ${toolName} not found`);
            }

            const showArgs = Object.values(args)
                .map((arg) => arg.substring(0, 20))
                .join(' ');
            this.print(`\nTOOL: ${toolName} ${showArgs}\n`);

            // Use safeTools from config instead of hardcoded array
            if (!this.config.yoloMode && !this.config.safeTools.includes(toolName)) {
                const confirm = await this.askForConfirmation(toolName, args);
                if (!confirm) {
                    this.print('Operation cancelled by user.');
                    return `Tool ${toolName} rejected by user`;
                }
            }
            const argsList: string[] = Object.values(args);
            const result: ExecuteResult = await tool.execute(...argsList);
            if (result.error) {
                this.print('Tool call error: ' + result.error);
            }

            if (result !== null) {
                let resultText = '';
                if (result.success) {
                    if (result.content !== undefined) {
                        resultText = `Tool ${toolName} returned:\n${result.content}`;
                    } else {
                        resultText = `Tool ${toolName} executed successfully.`;
                    }
                } else {
                    resultText = `Tool ${toolName} failed: ${result.error || 'Unknown error'}`;
                }
                return resultText;
            }
        } catch (error) {
            console.error(`Error executing tool ${toolcall.name}:`, error.message);
            return `Tool execution error: ${error.message}`;
        }
    }

    print(chunk: string) {
        this.window.print(chunk);
    }

    async run() {
        let currentMessages = this.messages;
        let hasToolCalls = true;

        while (hasToolCalls) {
            hasToolCalls = false;
            let response: LLMResponse;

            try {
                this.print('\n\x1b[32mAgent:\n\x1b[0m');
                response = await this.llm.streamResponse(
                    currentMessages,
                    this.print.bind(this),
                    (chunk: string) => process.stdout.write('\x1b[31m' + chunk + '\x1b[0m'),
                );

                this.print('\n');
                currentMessages.push({
                    role: 'assistant',
                    content: response.content,
                });

                if (response && response.stats) {
                    const stats = response.stats;
                    // Update status bar with token stats using updateState
                    this.window.statusBar.updateState({
                        promptTokens: stats.promptTokens,
                        promptCachedTokens: stats.promptCachedTokens,
                        completionTokens: stats.completionTokens,
                        totalTokens: stats.completionTokens,
                        model: this.llm.modelConfig.model,
                    });
                }

                let toolCalls = this.parseToolCalls(response.content);
                if (toolCalls.length > 0) {
                    hasToolCalls = true;
                    for (const toolCall of toolCalls) {
                        // Set tool status before execution
                        this.window.statusBar.setTool(toolCall.name);

                        const result = await this.processToolCall(toolCall);
                        if (result) {
                            const msg = {
                                role: 'tool',
                                content: result,
                            };
                            currentMessages.push(msg);
                        }

                        // Clear tool status after execution
                        this.window.statusBar.clearTool();
                    }
                }
            } catch (error) {
                console.error(`LLM Stream Error: ${error.message}`, error);
            }
        }

        if (this.singleShot) {
            process.exit(0);
        }
        this.showUserPrompt();
    }

    stopRequest() {
        this.llm.stopRequest();
        if (this.messages && this.messages.length > 0) {
            const lastMessage = this.messages.pop();
            this.print(
                '\n🛑 Removed last message from conversation: ' +
                    lastMessage.content.substring(0, 30),
            );
        }
    }
}

export default Agent;
