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
import type { Tools, ToolCall, ExecuteResult, Message, LLMResponse } from './interfaces.ts';
import eventBus from './eventBus.ts';
import { ImageHandler } from './image-handler.ts';
import { FileHandler } from './file-handler.ts';
import { ModelManager } from './model-manager.ts';

const log = Log.get('agent');

class Agent {
    window: Window;
    llm: LLM;
    tools: Tools = {};
    parser: Parser;
    messages: Message[] = [];
    config: Config;
    imageHandler: ImageHandler;
    fileHandler: FileHandler;
    modelManager: ModelManager;
    confirmation: (text: string) => void | null = null;

    constructor(config: Config) {
        this.config = config;
        this.window = new Window(this.messages);
        this.parser = this.initializeParser(this.config.parserType);
        this.imageHandler = new ImageHandler();
        this.fileHandler = new FileHandler();
        this.llm = new LLM(this.window.statusBar.updateState.bind(this.window.statusBar));
        this.modelManager = new ModelManager(this.llm, this.config);
        this.setupEventHandlers();
        Log.setPrintMethod(this.window.print.bind(this.window));
    }

    private setupEventHandlers(): void {
        eventBus.on('yoloMode', () => {
            this.toggleYoloMode();
        });
        eventBus.on('list_models', () => {
            this.handleListModels();
        });
        eventBus.on('select_model', (number: number) => {
            this.handleSelectModelByNumber(number);
        });
        eventBus.on('process_input', (text) => {
            this.processInput(text);
        });
        eventBus.on('exit', () => {
            this.stopRequest();
            setTimeout(() => {
                process.exit(0);
            }, 400);
        });
        eventBus.on('stop_request', () => {
            this.stopRequest();
        });
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
        this.window.statusBar.updateState({
            model: this.llm.modelConfig.model,
        });
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
        this.window.setPrompt(`Execute ${toolName} ${path}  (y/n): `);

        const confirm: Promise<string> = new Promise((res) => {
            this.confirmation = res;
        });
        const answer: string = await confirm;
        this.confirmation = null;
        const response = answer.trim().toLowerCase();
        return response === 'y' || response === 'yes';
    }

    process(input: string) {
        if (this.confirmation) {
            this.confirmation(input);
            return;
        }
        const loadedImage = this.imageHandler.getLoadedImageData();
        let content: any = input;

        if (loadedImage) {
            this.print(`\n\x1b[33mIncluding loaded image: ${loadedImage.fileName}\x1b[0m\n`);
            content = [
                { type: 'text', text: input },
                {
                    type: 'image_url',
                    image_url: {
                        url: `data:${loadedImage.mimeType};base64,${loadedImage.base64}`,
                    },
                },
            ];
            this.imageHandler.clearLoadedImage();
        }

        this.messages.push({
            role: 'user',
            content,
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

    processInput(input: string) {
        if (!input.trim()) {
            this.print('Input cannot be empty.');
            this.showUserPrompt();
            return;
        }

        if (input.toLowerCase() === 'exit') {
            this.window.setPrompt('Exiting...');
            eventBus.emit('exit');
            return;
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

        if (input.toLowerCase().startsWith('/clearimg')) {
            this.imageHandler.clearLoadedImage();
            this.showUserPrompt();
            return;
        }

        // Handle @filename syntax
        if (input.startsWith('@')) {
            this.handleFileInput(input);
        } else {
            this.process(input);
        }
    }

    /**
     * Handles the @filename syntax to load file contents as input.
     */
    async handleFileInput(input: string): Promise<void> {
        const result = await this.fileHandler.handleFileInput(input);

        if (result === undefined) {
            this.print(`\nFile not found or invalid file.\n`);
            this.showUserPrompt();
            return;
        }

        if (result === 'image') {
            // Handle as image
            const fileName = this.fileHandler.getFileNameFromInput(input);
            await this.loadAndShowImage(fileName);
            this.showUserPrompt();
        } else {
            // Text content loaded, process it
            this.process(result);
        }
    }

    /**
     * Loads and displays image information
     */
    async loadAndShowImage(fileName: string): Promise<void> {
        try {
            const imageData = await this.imageHandler.loadImageToBase64(fileName);
            this.print(`\n✓ Image loaded successfully!\n`);
            this.print(`File: ${fileName}\n`);
            this.print(`MIME type: ${imageData.mimeType}\n`);
            this.print(
                `Size: ${((imageData.base64.length * 3) / 4 / 1024 / 1024).toFixed(2)} MB\n`,
            );
            this.print(`Base64 length: ${imageData.base64.length.toLocaleString()} characters\n`);
            this.print(
                '\nThe image is now stored in memory and will be included in the next prompt.\n',
            );
        } catch (error) {
            this.handleError('Error loading image', error);
            this.print(
                `\nFailed to load image: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
            );
        }
    }

    showUserPrompt() {
        this.window.setPrompt('\x1b[34mUser: \x1b[0m');
    }

    async askQuestion(question: string, interactive: boolean) {
        if (!question.trim()) {
            throw new Error('Question cannot be empty.');
        }

        this.print('\nQuestion: ' + question);
        this.messages.push({
            role: 'user',
            content: question,
        });

        await this.run();
        if (!interactive) {
            eventBus.emit('exit');
        }
    }

    /**
     * Handles the list_models event to show all available models
     */
    async handleListModels(): Promise<void> {
        await this.modelManager.handleListModels();
        this.print(`\nCurrent model: ${this.llm.modelConfig.name} \n`);
    }

    /**
     * Handles the select_model event to select a model by number
     */
    async handleSelectModelByNumber(number: number): Promise<void> {
        const success = await this.modelManager.handleSelectModelByNumber(number);
        if (success) {
            this.print(`\n✓ Model switched to: ${this.llm.modelConfig.model} \n`);
        } else {
            this.print(
                `\nInvalid model number. Please select between 1 and ${this.llm.modelConfig.model.length}.\n`,
            );
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
            this.print(`\x1b[32mTOOL: ${toolName} ${showArgs} \x1b[0m\n`);

            // Check for confirmation
            if (!(this.config.yoloMode || tool.safe)) {
                const confirm = await this.askForConfirmation(toolName, args);
                if (!confirm) {
                    log.debug('Operation cancelled by user.');
                    return `Tool ${toolName} rejected by user.`;
                }
            }

            log.debug(`TOOL: ${toolName} ${JSON.stringify(args)} `);
            // Execute tool
            const argsList: string[] = Object.values(args);
            this.window.setPrompt('Executing tool: ' + toolName);
            const result: ExecuteResult = await tool.execute(...argsList);
            return JSON.stringify(result);
        } catch (error) {
            this.handleError(`Error executing tool ${toolcall.name} `, error);
            return `Tool execution error: ${error instanceof Error ? error.message : 'Unknown error'} `;
        }
    }

    print(chunk: string) {
        this.window.print(chunk);
    }

    updateStats(stats) {
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

    async run() {
        let currentMessages = this.messages;
        let complete = false;

        while (!complete) {
            complete = true;
            let response: LLMResponse;

            try {
                this.print('\n\x1b[32mAgent: \x1b[0m');
                this.window.startAgent();

                this.window.setPrompt('Llm request processing...');
                response = this.llm.makeRequest(currentMessages, this.tools);
                currentMessages.push(response.msg);
                await response.done;
                this.updateStats(response.stats);

                const toolCalls: ToolCall[] = this.parser.parseToolCalls(response.msg, this.tools);

                if (toolCalls.length > 0) {
                    complete = false;
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

        this.showUserPrompt();
    }

    stopRequest() {
        this.llm.stopRequest();
        this.showUserPrompt();
        if (this.messages && this.messages.length > 0) {
            const lastMessage = this.messages.pop();
            const contentPreview =
                typeof lastMessage?.content === 'string'
                    ? lastMessage.content.substring(0, 30)
                    : 'Array content';
            log.debug(`Removed last message from conversation: ${contentPreview || 'Unknown'} `);
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
