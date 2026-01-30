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

const log = Log.get('agent');

class Agent {
    window: Window;
    llm: LLM;
    tools: Tools;
    parser: Parser;
    singleShot: boolean;
    messages: Message[];
    config: Config;

    constructor(config: Config) {
        this.config = config;
        this.window = new Window(
            this.processInput.bind(this),
            this.stopRequest.bind(this),
            false,
            this,
        );
        Log.setPrintMethod(this.window.print.bind(this.window));
        this.llm = new LLM(this.window.statusBar.updateState.bind(this.window.statusBar));
        this.tools = {};
        this.singleShot = false;
        this.messages = [];
        this.parser = this.initializeParser(this.config.parserType);
    }

    /**
     * Initializes the parser based on the configuration.
     */
    private initializeParser(parserType: string): Parser {
        log.info('Parser type: ' + parserType);
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
        this.window.setReady();
    }

    async loadTools() {
        const tools = await loadTools();
        this.tools = tools;
        log.info(`Loaded ${Object.keys(this.tools).length} tools`);
    }

    /**
     * Handles errors consistently.
     */
    private handleError(context: string, error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error(`${context}: ${errorMessage}`);
        console.error(`${context}:`, error);
    }

    async askForConfirmation(toolName: string, args: Record<string, any>): Promise<boolean> {
        let path = '';
        Object.entries(args).forEach(([name, value]) => {
            if (name === 'path') {
                path = value;
            }
            this.print(name + '\n');
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

        if (input.toLowerCase() === '/msgs') {
            this.messages.forEach((msg) => log.info(JSON.stringify(msg, null, 4)));
            this.showUserPrompt();
            return;
        }

        if (input.toLowerCase() === '/pop') {
            this.messages.pop();
            this.showUserPrompt();
            return;
        }

        if (input.toLowerCase().startsWith('/model')) {
            this.handleModelCommand(input).then(() => this.showUserPrompt());
            return;
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

    /**
     * Handles the /model command to list and select models.
     * Usage: /model list - List all available models
     *        /model <number> - Select a model by number (1, 2, 3, etc.)
     *        /model <name> - Select a model by name
     */
    async handleModelCommand(input: string): Promise<void> {
        const args = input.trim().split(/\s+/);
        const command = args[0].toLowerCase();
        const modelNameOrNumber = args[1];

        try {
            if (command === '/model' && !modelNameOrNumber) {
                // Show current model
                const currentModel = this.llm.modelConfig;
                this.print(`\nCurrent model: ${currentModel.name}\n`);
                this.print(`Base URL: ${currentModel.baseUrl}\n`);
                this.print(`Model ID: ${currentModel.model}\n`);
                return;
            }

            if (command === '/model' && modelNameOrNumber) {
                // Fetch models
                const modelsData = await this.llm.fetchModels();
                const models = modelsData.data || [];

                if (!Array.isArray(models)) {
                    throw new Error('Invalid models response format');
                }

                // Check if input is a number
                const numberIndex = parseInt(modelNameOrNumber, 10);
                if (!isNaN(numberIndex) && numberIndex >= 1 && numberIndex <= models.length) {
                    // Select model by number
                    const model = models[numberIndex - 1];

                    // Update the config
                    this.config.modelName = model.id;
                    this.llm.updateModelConfig(model);

                    this.print(`\n✓ Model switched to: ${model.id}\n`);
                    this.print(
                        `  Base URL: ${this.config.models.find((m: any) => m.name === model.id)?.baseUrl}\n`,
                    );
                    this.print(`  ID: ${model.id}\n`);
                } else {
                    // Try to find the model by name
                    const model = models.find(
                        (m: any) => m.id.toLowerCase() === modelNameOrNumber.toLowerCase(),
                    );

                    if (model) {
                        // Update the config
                        this.config.modelName = model.id;
                        this.llm.updateModelConfig(model);

                        this.print(`\n✓ Model switched to: ${model.id}\n`);
                        this.print(
                            `  Base URL: ${this.config.models.find((m: any) => m.name === model.id)?.baseUrl}\n`,
                        );
                        this.print(`  ID: ${model.id}\n`);
                    } else {
                        // List all available models if not found
                        this.print(`\nModel '${modelNameOrNumber}' not found. Available models:\n`);
                        models.forEach((m: any, index: number) => {
                            this.print(`  ${index + 1}. ${m.id}\n`);
                        });
                    }
                }
            } else {
                this.print(`\nUsage: /model list - List all available models\n`);
                this.print(`       /model <number> - Select a model by number (1, 2, 3, etc.)\n`);
                this.print(`       /model <name> - Select a model by name\n`);
                this.print(`       /model        - Show current model\n`);
            }
        } catch (error) {
            this.handleError('Error processing /model command', error);
        }
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
                    if (typeof arg === 'string') return arg?.substring(0, 80);
                    else return JSON.stringify(arg).substring(0, 80);
                })
                .join(' ');
            this.print(`\x1b[32mTOOL: ${toolName} ${showArgs}\x1b[0m\n`);

            // Check for confirmation
            if (!(this.config.yoloMode || tool.safe)) {
                const confirm = await this.askForConfirmation(toolName, args);
                if (!confirm) {
                    log.debug('Operation cancelled by user.');
                    return `Tool ${toolName} rejected by user.`;
                }
            }

            this.print(`\x1b[32mRunning tool: ${toolName}\x1b[0m\n`);
            log.debug(`TOOL: ${toolName} ${JSON.stringify(args)}`);
            // Execute tool
            const argsList: string[] = Object.values(args);
            const result: ExecuteResult = await tool.execute(...argsList);
            return JSON.stringify(result);
            // if (result.error) {
            //    const err = `Tool call ${toolName} error: ${result.error} `;
            //    log.error(err);
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

                //this.window.clearAgentInput();
                //this.print(response.msg.content);

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
                        log.debug(JSON.stringify(msg));
                        currentMessages.push(msg);

                        this.window.statusBar.clearTool();
                    }
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    log.info('User cancelled request');
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
            log.debug(
                `Removed last message from conversation: ${lastMessage?.content?.substring(0, 30) || 'Unknown'}`,
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
