import LLM from './llm.ts';
import { systemPrompt } from './systemPrompt.ts';
import type { Config } from './config.ts';
import { JSONParser } from './parser-json.ts';
import type { Parser } from './parser.ts';
import { PlainTextParser } from './parser-plain.ts';
import { NativeParser } from './parser-native.ts';
import Window from './window.ts';
import Log from './log.ts';
import { loadTools } from './toolLoader.ts';
import type { Tools, ToolCall, ExecuteResult, Message } from './interfaces.ts';

class Agent {
    window: Window;
    llm: LLM;
    tools: Tools;
    parser: Parser;
    singleShot: boolean;
    messages: Message[];
    config: Config;
    log: Log;

    constructor(config: Config) {
        this.config = config;
        this.window = new Window(
            this.processInput.bind(this),
            this.stopRequest.bind(this),
            false,
            this,
        );
        this.log = new Log(this.window.print.bind(this.window), this.config.logLevel);
        this.llm = new LLM(this.window.statusBar.updateState.bind(this.window.statusBar), this.log);
        this.tools = {};
        this.singleShot = false;
        this.messages = [];
        this.parser = this.initializeParser(this.config.parserType);
    }

    /**
     * Initializes the parser based on the configuration.
     */
    private initializeParser(parserType: string): Parser {
        this.log.info('Parser type: ' + parserType + '\n');
        switch (parserType) {
            case 'json':
                return new JSONParser();
            case 'plain':
                return new PlainTextParser();
            case 'native':
                return new NativeParser();
            default:
                throw new Error(`Unknown parser type: ${parserType}`);
        }
    }

    async init() {
        await this.loadTools();
        this.messages.push({
            role: 'system',
            content: systemPrompt(this.tools, this.parser.toolPrompt, this.config.rulesFile),
        });
    }

    async loadTools() {
        const tools = await loadTools();
        this.tools = tools;
        this.log.info(`Loaded ${Object.keys(this.tools).length} tools\n`);
    }

    /**
     * Handles errors consistently.
     */
    private handleError(context: string, error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.log.error(`${context}: ${errorMessage}`);
        console.error(`${context}:`, error);
    }

    async askForConfirmation(toolName: string, args: Record<string, any>): Promise<boolean> {
        let path = '';
        Object.entries(args).forEach(([name, value]) => {
            if (name === 'path') {
                path = value;
            }
            this.print(name + ':\n');
            this.print(value + '\n');
        });
        this.print(`Execute ${toolName} ${path}  (y/n): `);
        const answer: string = await this.window.inputHandler.waitPrompt();
        const response = (answer as string).trim().toLowerCase();
        return response === 'y' || response === 'yes';
    }

    processInput(input: string) {
        if (!input.trim()) {
            this.print('Input cannot be empty.');
            this.showUserPrompt();
            return;
        }

        if (input.toLowerCase() === 'exit') {
            this.print('\nGoodbye!\n');
            process.exit(0);
        }

        //this.window.print('\n\x1b[34mUser: \x1b[0m' + input);

        this.messages.push({
            role: 'user',
            content: input,
        });

        try {
            this.run();
        } catch (error) {
            this.handleError('Error processing input', error);
            this.messages.push({
                role: 'assistant',
                content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            });
        }
    }

    showUserPrompt() {
        this.print('\n\x1b[34mUser: \x1b[0m');
    }

    async askQuestion(question: string, interactive: boolean) {
        if (!question.trim()) {
            throw new Error('Question cannot be empty.');
        }

        this.print('\nQuestion: ' + question);
        this.singleShot = !interactive;
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

            // Validate tool existence
            const tool = this.tools[toolName];
            if (!tool) {
                throw new Error(`Tool ${toolName} not found`);
            }

            // Log tool call
            const showArgs = Object.values(args)
                .map((arg) => {
                    if (typeof arg === 'string') return arg?.substring(0, 20);
                    else return JSON.stringify(arg).substring(0, 20);
                })
                .join(' ');
            this.print(`\x1b[32mTOOL: ${toolName} ${showArgs}\x1b[0m\n`);

            // Check for confirmation
            if (!(this.config.yoloMode || tool.safe)) {
                const confirm = await this.askForConfirmation(toolName, args);
                if (!confirm) {
                    this.log.debug('Operation cancelled by user.');
                    return `Tool ${toolName} rejected by user.`;
                }
            }

            this.log.debug(`TOOL: ${toolName} ${JSON.stringify(args)}\n`);
            // Execute tool
            const argsList: string[] = Object.values(args);
            const result: ExecuteResult = await tool.execute(...argsList);
            return JSON.stringify(result);
            // if (result.error) {
            //    const err = `Tool call ${toolName} error: ${result.error} `;
            //    this.log.error(err);
            //    return err;
            // }
            //return result.content;
        } catch (error) {
            this.handleError(`Error executing tool ${toolcall.name}`, error);
            return `Tool execution error: ${error instanceof Error ? error.message : 'Unknown error'}`;
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
            let response;

            try {
                this.print('\n\x1b[32mAgent:\n\x1b[0m');
                this.window.startAgent();
                response = await this.llm.makeRequest(
                    currentMessages,
                    this.tools,
                    this.print.bind(this),
                    (chunk: string) => this.print('\x1b[31m' + chunk + '\x1b[0m'),
                );

                this.window.clearAgentInput();
                this.window.print(response.msg.content);

                this.print('\n');
                if (response && response.stats) {
                    const stats = response.stats;
                    this.window.statusBar.updateState({
                        promptTokens: stats.promptTokens,
                        promptCachedTokens: stats.promptCachedTokens,
                        completionTokens: stats.completionTokens,
                        totalTokens: stats.completionTokens,
                        tokensPerSecond: stats.tokensPerSecond,
                        promptProcessingPerSecond: stats.promptProcessingPerSecond,
                        model: this.llm.modelConfig.model,
                    });
                }

                const toolCalls: ToolCall[] = this.parser.parseToolCalls(response.msg, this.tools);

                if (toolCalls.length > 0) {
                    hasToolCalls = true;
                    for (const toolCall of toolCalls) {
                        this.window.statusBar.setTool(toolCall.name);
                        const result = await this.processToolCall(toolCall);
                        const msg = {
                            role: 'tool',
                            name: toolCall.name,
                            content: result,
                            tool_call_id: toolCall.id,
                        };
                        this.log.debug(JSON.stringify(msg));
                        currentMessages.push(msg);

                        this.window.statusBar.clearTool();
                    }
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    this.log.info('User cancelled request');
                    currentMessages.pop();
                } else {
                    this.handleError('LLM Stream Error', error);
                }
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
            this.log.debug(
                `\n🛑 Removed last message from conversation: ${lastMessage?.content?.substring(0, 30) || 'Unknown'}\n`,
            );
        }
    }

    /**
     * Toggle YOLO mode on/off and update status bar
     */
    toggleYoloMode() {
        this.config.yoloMode = !this.config.yoloMode;

        // Update the status bar text to show current mode
        this.window.statusBar.updateState({
            yoloMode: this.config.yoloMode,
        });
    }
}

export default Agent;
