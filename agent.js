const LLM = require('./llm');
const { parseToolCalls, setTools, toolPrompt } = require('./parser');
const { systemPrompt } = require('./systemPrompt');
const {
    parseToolCalls: parseToolCallsJson,
    setTools: setToolsJson,
    toolPrompt: toolPromptJson,
} = require('./parser-json');
const Window = require('./window');
const safeTools = ['readFile'];
const ToolLoader = require('./toolLoader');

class Agent {
    constructor(parserType = 'plain') {
        this.window = new Window();
        this.llm = new LLM(this.window.statusBar.updateState.bind(this.window.statusBar));
        this.statusBar = this.window.statusBar;
        this.tools = {};
        this.parserType = parserType;
        this.parseToolCalls = parseToolCalls;
        this.toolPrompt = toolPrompt;
        this.loadTools();
        this.singleShot = false;
        this.messages = [];
        this.yoloMode = false;

        if (parserType === 'json') {
            this.parseToolCalls = parseToolCallsJson;
            this.toolPrompt = toolPromptJson;
        }

        this.messages.push({
            role: 'system',
            content: systemPrompt(this.tools, this.toolPrompt),
        });
        this.setupReadInput();
    }

    loadTools() {
        const tools = ToolLoader.loadTools();
        this.tools = tools;
        setTools(this.tools);
        setToolsJson(this.tools);
        this.print(`Loaded ${Object.keys(this.tools).length} tools`);
    }

    async askForConfirmation(toolName, args) {
        const result = await new Promise((resolve) => {
            this.print(`Execute ${toolName} with args: ${JSON.stringify(args)}? (y/n): `);
            process.stdin.once('data', (answer) => {
                const response = answer.trim();
                resolve(/^y(es)?$/i.test(response));
            });
        });
        this.print('\n');
        return result;
    }

    processInput(input) {
        //this.print("This does not print?");
        if (input.toLowerCase() === '') {
            this.print('Goodbye!');
            process.exit(0);
        }

        this.messages.push({
            role: 'user',
            content: input,
        });

        try {
            this.print('\nAgent: ');
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
        this.print('\nUser: ');
    }

    setupReadInput() {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        let buffer = '';
        let agent = this;
        process.stdin.on('data', (chunk) => {
            const code = chunk.charCodeAt(0);

            if (code === 13) {
                // ENTER key (CR)
                //process.stdin.setRawMode(false);
                agent.processInput(buffer);
                buffer = '';
            }

            if (code === 10 && chunk === '\n') {
                // Raw mode still emits LF sometimes, but Enter is CR above (13)
                // So treat plain LF only as typed text
                buffer += '\n';
                this.print('\n');
                return;
            }

            if (code === 10 && process.stdin.isRaw) {
                // Ctrl+J generates LF (10)
                buffer += '\n';
                this.print('\n');
                return;
            }

            // Normal characters
            buffer += chunk;
            //this.print(chunk);
        });

        process.stdin.on('end', () => {
            this.print('\nInput ended');
            console.log('\nInput ended');
        });
    }

    async askQuestion(question) {
        this.singleShot = true;
        this.messages.push({
            role: 'user',
            content: question,
        });

        await this.run();
    }

    async processToolCall(toolcall) {
        try {
            const toolName = toolcall.name;
            const args = toolcall.arguments || {};
            const tool = this.tools[toolName];
            if (!tool) {
                throw new Error(`Tool ${toolName} not found`);
            }

            const showArgs = args.map((arg) => arg.substring(0, 20)).join(' ');
            this.print(`\nTOOL: ${toolName} ${showArgs}\n`);

            if (!this.yoloMode && !safeTools.includes(toolName)) {
                const confirm = await this.askForConfirmation(toolName, args);
                if (!confirm) {
                    this.print('Operation cancelled by user.');
                    return `Tool ${toolName} rejected by user`;
                }
            }

            const result = await tool.execute(...args);
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

    print(chunk) {
        this.window.print(chunk);
    }

    async run() {
        let currentMessages = this.messages;
        let hasToolCalls = true;

        while (hasToolCalls) {
            hasToolCalls = false;
            let response;

            try {
                response = await this.llm.streamResponse(
                    currentMessages,
                    this.print.bind(this),
                    (chunk) => process.stdout.write('\x1b[31m' + chunk + '\x1b[0m'),
                );

                this.print('\n');
                currentMessages.push({
                    role: 'assistant',
                    content: response.content,
                });

                //this.print(response)
                if (response && response.stats) {
                    const stats = response.stats;
                    // Update status bar with token stats using updateState
                    this.window.statusBar.updateState({
                        promptTokens: stats.promptTokens,
                        completionTokens: stats.completionTokens,
                        totalTokens: stats.totalTokens,
                        model: this.llm.modelConfig.model,
                    });
                }

                let toolCalls = this.parseToolCalls(response.content);
                if (toolCalls.length > 0) {
                    hasToolCalls = true;
                    for (const toolCall of toolCalls) {
                        // Set tool status before execution
                        this.statusBar.setTool(toolCall.name);

                        const result = await this.processToolCall(toolCall, currentMessages);
                        if (result) {
                            const msg = {
                                role: 'tool',
                                content: result,
                            };
                            currentMessages.push(msg);
                        }

                        // Clear tool status after execution
                        this.statusBar.clearTool();
                    }
                }
                // Update status bar with token stats after response
            } catch (error) {
                console.error(`LLM Stream Error: ${error.message}`, error);
            }
        }

        if (!this.singleShot) {
            this.showUserPrompt();
        }
    }

    stopRequest() {
        this.llm.stopRequest();
        if (this.messages && this.messages.length > 0) {
            const lastMessage = this.messages.pop();
            this.print('\n🛑 Removed last message from conversation:', lastMessage.content);
        }
    }
}

module.exports = Agent;
