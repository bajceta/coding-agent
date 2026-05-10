import LLM from './llm.ts';
import { systemPrompt } from './systemPrompt.ts';
import type { Config } from './config.ts';
import { JSONParser } from './parser-json.ts';
import type { Parser } from './parser.ts';
import { PlainTextParser } from './parser-plain.ts';
import { NativeParser } from './parser-native.ts';
import Window from './window.ts';
import Log, { createPrintFunction } from './log.ts';
import { loadTools } from './toolLoader.ts';
import type { Tools, ToolCall, ExecuteResult, Message, LLMResponse } from './interfaces.ts';
import eventBus from './eventBus.ts';
import { ImageHandler } from './image-handler.ts';
import { FileHandler } from './file-handler.ts';
import { ModelManager } from './model-manager.ts';
import { evaluateCommandMode } from './evaluateCommand.ts';
import dns from 'node:dns';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
    private modeChanged: boolean = true;

    constructor(config: Config) {
        this.config = config;
        this.window = new Window(this.messages);
        this.parser = this.initializeParser(this.config.parserType);
        this.imageHandler = new ImageHandler();
        this.fileHandler = new FileHandler();
        this.llm = new LLM(this.window.statusBar.updateState.bind(this.window.statusBar));
        this.modelManager = new ModelManager(this.llm, this.config);
        this.setupEventHandlers();
        // Wrap the window print method to also write to log file if configured
        const windowPrint = this.window.print.bind(this.window);
        Log.setPrintMethod(createPrintFunction(windowPrint));
    }

    private setupEventHandlers(): void {
        eventBus.on('toggleMode', () => {
            this.toggleMode();
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
            log.info('exit event');
            this.stopRequest();
            setTimeout(() => {
                process.exit(0);
            }, 400);
        });
        eventBus.on('stop_request', () => {
            this.stopRequest();
        });
        eventBus.on('confirm', (answer: string) => {
            if (this.confirmation) {
                this.confirmation(answer);
                this.confirmation = null;
            }
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
        if (this.config.tools) {
            const tools = await loadTools();
            this.tools = tools;
        }
        log.info(`Loaded ${Object.keys(this.tools).length} tools`);

        log.info(`DNS servers: ${dns.getServers().join(', ')}`);
    }

    /**
     * Handles errors consistently.
     */
    private handleError(context: string, error: unknown) {
        if (error instanceof Error) {
            log.error(error.stack);
            log.error(`${context}: ${error.message}`);
        } else {
            log.error(`${context}: ${error}`);
        }
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

        // Append mode description to first prompt or after mode change
        if (this.modeChanged) {
            const modeDescription = this.getModeDescription(this.config.executionMode);
            const modePrefix = `[Mode: ${modeDescription}] `;

            if (loadedImage) {
                // Prepend to the text part of the image content
                if (Array.isArray(content)) {
                    content = [{ type: 'text', text: modePrefix + input }, content[1]];
                }
            } else {
                content = modePrefix + content;
            }

            this.modeChanged = false;
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

    /**
     * Command handlers for special input patterns.
     * Each handler takes the input string and returns void.
     */
    private commandHandlers: Record<string, (input: string) => void> = {
        '/msgs': (_input) => {
            this.messages.forEach((msg) => log.info(JSON.stringify(msg, null, 4)));
            this.showUserPrompt();
        },
        '/pop': (_input) => {
            if (this.messages.length > 0) {
                this.messages.pop();
            } else {
                this.print('No messages to pop.');
            }
            this.showUserPrompt();
        },
    };

    /**
     * Handles user input, routing to appropriate command handlers or processing.
     */
    processInput(input: string) {
        // Validate empty input
        if (!input.trim()) {
            this.print('Input cannot be empty.');
            this.showUserPrompt();
            return;
        }

        // Handle exit command
        if (input.toLowerCase() === 'exit') {
            this.window.setPrompt('Exiting...');
            eventBus.emit('exit');
            return;
        }

        // Check for exact-match command handlers
        const lowercaseInput = input.toLowerCase();
        if (lowercaseInput in this.commandHandlers) {
            this.commandHandlers[lowercaseInput](input);
            return;
        }

        // Handle /clearimg command (prefix match)
        if (lowercaseInput.startsWith('/clearimg')) {
            this.imageHandler.clearLoadedImage();
            this.showUserPrompt();
            return;
        }

        // Handle @filename syntax for file input
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
        log.info('Ask question, interactive: ' + interactive);
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
        await this.modelManager.handleListModels(false);
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

            //this.print(`\x1b[32mTOOL: ${toolName} ${showArgs} \x1b[0m\n`);

            // Check if tool execution is allowed in current mode
            const allowedInMode = this.isToolAllowedInMode(toolName);

            // For runCommand, do additional command-level validation
            if (toolName === 'runCommand') {
                const command = args.command || args[0] || '';
                if (!this.isCommandAllowedInMode(command)) {
                    const cmdMode = evaluateCommandMode(command);
                    log.debug(
                        `Command '${command}' is ${cmdMode} mode, not allowed in ${this.config.executionMode} mode.`,
                    );
                    // Ask for confirmation instead of rejecting
                    const confirmed = await this.askForModeSwitch(toolName, cmdMode, command);
                    if (!confirmed) {
                        return `Command '${command}' (${cmdMode} mode) not allowed in ${this.config.executionMode} mode.`;
                    }
                }
            } else {
                if (!allowedInMode) {
                    const toolMode = this.getToolMode(toolName);
                    log.debug(`Tool ${toolName} not allowed in ${this.config.executionMode} mode.`);
                    // Ask for confirmation instead of rejecting
                    const confirmed = await this.askForModeSwitch(toolName, toolMode);
                    if (!confirmed) {
                        return `Tool ${toolName} not allowed in ${this.config.executionMode} mode.`;
                    }
                }
            }

            log.debug(`TOOL: ${toolName} ${JSON.stringify(args)} `);
            // Execute tool
            const argsList = [];
            tool.arguments.forEach((arg) => {
                const name = Object.keys(arg)[0];
                log.debug(name);
                argsList.push(args[name]);
            });
            log.debug(JSON.stringify(argsList));

            this.window.setPrompt('Executing tool: ' + toolName);
            const result: ExecuteResult = await tool.execute(...argsList);

            // Skip truncation for readFile tool to allow reading large files
            if (toolName !== 'readFile') {
                const MAX_OUTPUT_LENGTH = 2000;
                if (result.content?.length > MAX_OUTPUT_LENGTH) {
                    const truncated = result.content.substring(0, MAX_OUTPUT_LENGTH);
                    const lastNewline = truncated.lastIndexOf('\n');
                    const cutPoint = lastNewline > -1 ? lastNewline : MAX_OUTPUT_LENGTH;
                    result.content =
                        result.content.substring(0, cutPoint) +
                        '\n\n[... output truncated - ' +
                        (result.content.length - cutPoint) +
                        ' more characters]';
                }
            }

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

                    // Check if any tool call is writeFile or replace
                    const hasWriteOrReplace = toolCalls.some(
                        (tc) => tc.name === 'writeFile' || tc.name === 'replace',
                    );

                    for (const toolCall of toolCalls) {
                        if (!toolCall) continue;
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

                    // If any tool was writeFile or replace, run TypeScript compilation
                    if (hasWriteOrReplace) {
                        try {
                            log.debug('Running TypeScript compilation after file modifications');
                            this.window.setPrompt('Compiling TypeScript...');
                            const { stdout, stderr } = await execAsync(
                                'npx --yes tsc -p tsconfig.json',
                            );
                            const compilationOutput =
                                stdout || stderr || 'TypeScript compilation completed.';

                            // Append compilation result to the last tool message
                            if (currentMessages.length > 0) {
                                const lastMsg = currentMessages[currentMessages.length - 1];
                                if (lastMsg.role === 'tool') {
                                    lastMsg.content += `\n\nTypeScript compilation result:\n${compilationOutput}`;
                                    log.debug(
                                        'Appended TypeScript compilation result to last tool message',
                                    );
                                }
                            }
                        } catch (error) {
                            const errorMsg =
                                error instanceof Error ? error.message : 'Unknown error';
                            log.debug(`TypeScript compilation failed: ${errorMsg}`);

                            // Append compilation error to the last tool message
                            if (currentMessages.length > 0) {
                                const lastMsg = currentMessages[currentMessages.length - 1];
                                if (lastMsg.role === 'tool') {
                                    lastMsg.content += `\n\nTypeScript compilation error:\n${errorMsg}`;
                                }
                            }
                        }
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
     * Toggle through execution modes: read -> write -> run -> read
     */
    toggleMode(): void {
        const modes: ('read' | 'write' | 'run')[] = ['read', 'write', 'run'];
        const currentIndex = modes.indexOf(this.config.executionMode);
        const nextIndex = (currentIndex + 1) % 3;
        const nextMode = modes[nextIndex];

        this.setExecutionMode(nextMode);
        this.modeChanged = true;
    }

    /**
     * Get the mode description for display to the user
     */
    private getModeDescription(mode: 'read' | 'write' | 'run'): string {
        const descriptions = {
            read: 'read mode, no files can be modified, ask user to move to write or run mode',
            write: 'write mode, files can be modified but commands cannot be run, ask user to move to run mode for command execution',
            run: 'run mode, all operations allowed including command execution',
        };
        return descriptions[mode];
    }

    /**
     * Check if a tool is allowed in the current execution mode
     */
    isToolAllowedInMode(toolName: string): boolean {
        const mode = this.config.executionMode;

        // Define which tools are allowed in each mode
        const readTools = ['readFile', 'findFiles', 'findText', 'lsp', 'browser'];
        const writeTools = ['writeFile', 'replace', 'applyPatch'];
        const runTools = ['runCommand'];

        switch (mode) {
            case 'read':
                return readTools.includes(toolName);
            case 'write':
                return readTools.includes(toolName) || writeTools.includes(toolName);
            case 'run':
                return (
                    readTools.includes(toolName) ||
                    writeTools.includes(toolName) ||
                    runTools.includes(toolName)
                );
            default:
                return false;
        }
    }

    /**
     * Check if a tool is a write operation
     */
    isWriteTool(toolName: string): boolean {
        const writeTools = ['writeFile', 'replace', 'applyPatch'];
        return writeTools.includes(toolName);
    }

    /**
     * Get the mode required for a tool
     */
    getToolMode(toolName: string): 'read' | 'write' | 'run' {
        const readTools = ['readFile', 'findFiles', 'findText', 'lsp', 'browser'];
        const writeTools = ['writeFile', 'replace', 'applyPatch'];
        const runTools = ['runCommand'];

        if (readTools.includes(toolName)) return 'read';
        if (writeTools.includes(toolName)) return 'write';
        if (runTools.includes(toolName)) return 'run';
        return 'run'; // Default to run for unknown tools
    }

    /**
     * Ask for confirmation when a tool/command requires a higher mode
     */
    async askForModeSwitch(
        toolName: string,
        requiredMode: string,
        command?: string,
    ): Promise<boolean> {
        const currentMode = this.config.executionMode;
        const modeHierarchy = ['read', 'write', 'run'];
        const currentIndex = modeHierarchy.indexOf(currentMode);
        const requiredIndex = modeHierarchy.indexOf(requiredMode);

        // Only ask if the current mode is lower than required
        if (currentIndex >= requiredIndex) {
            return true;
        }

        const description = command
            ? `Command '${command}' requires ${requiredMode} mode`
            : `Tool '${toolName}' requires ${requiredMode} mode`;

        //this.print(`\n\x1b[33m⚝ ${description}\x1b[0m\n`);
        //this.print(`Current mode: ${currentMode}\n`);
        //this.print(`Switch to ${requiredMode} mode? (y/n): `);

        this.window.setPrompt(`${description}. Allow? (y/n): `);

        const confirm: Promise<string> = new Promise((res) => {
            this.confirmation = res;
        });

        try {
            const answer: string = await confirm;
            const response = answer.trim().toLowerCase();
            return response === 'y' || response === 'yes';
        } finally {
            this.confirmation = null;
        }
    }

    /**
     * Check if a command is allowed in the current execution mode
     * This provides fine-grained control within runCommand tool
     */
    isCommandAllowedInMode(command: string): boolean {
        const mode = this.config.executionMode;

        // In read mode, only read commands are allowed
        if (mode === 'read') {
            const commandMode = evaluateCommandMode(command);
            return commandMode === 'read';
        }

        // In write mode, only read and write commands are allowed
        if (mode === 'write') {
            const commandMode = evaluateCommandMode(command);
            return commandMode === 'read' || commandMode === 'write';
        }

        // In run mode, everything is allowed
        return true;
    }

    /**
     * Set execution mode
     */
    setExecutionMode(mode: 'read' | 'write' | 'run'): void {
        this.config.executionMode = mode;
        eventBus.emit('mode', mode);
        this.window.statusBar.updateState({
            executionMode: mode,
        });
        this.showUserPrompt();
    }

    /**
     * Get current execution mode
     */
    getExecutionMode(): string {
        return this.config.executionMode;
    }
}

export default Agent;
