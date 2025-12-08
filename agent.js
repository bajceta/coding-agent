const LLM = require('./llm');
const fs = require('fs');
const path = require('path');
const { parseToolCalls, setTools, toolPrompt } = require('./parser');
const { systemPrompt } = require('./systemPrompt');
const {
    parseToolCalls: parseToolCallsJson,
    setTools: setToolsJson,
    toolPrompt: toolPromptJson,
} = require('./parser-json');
const Window = require('./window');

const safeTools = ['readFile'];

class Agent {
    constructor(rl, parserType = 'plain') {
        this.window = new Window();
        this.llm = new LLM();
        this.tools = {};
        this.parserType = parserType;
        this.parseToolCalls = parseToolCalls;
        this.toolPrompt = toolPrompt;
        this.loadTools();
        this.readline = rl;
        this.singleShot = false;
        this.messages = []; // Store reference to messages array
        if (parserType === 'json') {
            this.parseToolCalls = parseToolCallsJson;
            this.toolPrompt = toolPromptJson;
        }
        this.messages.push({
            role: 'system',
            content: systemPrompt(this.tools, this.toolPrompt),
        });
    }

    loadTools() {
        const toolsDir = path.join(__dirname, 'tools');
        if (fs.existsSync(toolsDir)) {
            const files = fs.readdirSync(toolsDir);
            for (const file of files) {
                if (file.endsWith('.js') && file !== 'index.js') {
                    const toolName = path.basename(file, '.js');
                    try {
                        const toolModule = require(path.join(toolsDir, file));
                        toolModule.name = toolName;
                        this.tools[toolName] = toolModule;
                    } catch (error) {
                        console.error(`Failed to load tool ${toolName}:`, error.message);
                    }
                }
            }
        }

        // Set tools for both parsers
        setTools(this.tools);
        setToolsJson(this.tools);

        // Print number of loaded tools
        this.print(`Loaded ${Object.keys(this.tools).length} tools`);
    }

    async askForConfirmation(toolName, args) {
        return new Promise((resolve) => {
            this.readline.question(
                `Execute ${toolName} with args: ${JSON.stringify(args)}? (y/n): `,
                (answer) => {
                    resolve(/^y(es)?$/i.test(answer));
                },
            );
        });
    }

    async showUserPrompt() {
        this.readline.question('> ', async (input) => {
            if (input.toLowerCase() === 'exit') {
                this.print('Goodbye!');
                this.readline.close();
                return;
            }

            // Add user message to conversation
            this.messages.push({
                role: 'user',
                content: input,
            });

            try {
                this.print('\nAgent: ');
                await this.run();
            } catch (error) {
                console.error('Error:', error.message);
                console.error('Error:', error.stack);
                this.messages.push({
                    role: 'assistant',
                    content: `Error: ${error.message}`,
                });
            }
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

    // Process a single tool call
    async processToolCall(toolCallData, messages) {
        try {
            const toolName = toolCallData.name;
            const args = toolCallData.arguments || {};
            const tool = this.tools[toolName];
            if (!tool) {
                throw new Error(`Tool ${toolName} not found`);
            }
            const showArgs = args.map((arg) => arg.substring(0, 20)).join(' ');
            this.print(`\nTOOL: ${toolName} ${showArgs}\n`);
            // For write and run command tools, we need to ask for user confirmation
            if (!safeTools.includes(toolName)) {
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
                // Only proceed if execution was confirmed
                let resultText = '';
                if (result.success) {
                    if (result.content !== undefined) {
                        resultText = `Tool ${toolName} returned:\n${result.content}`;
                    } else if (result.message) {
                        resultText = `Tool ${toolName} returned:\n${result.message}`;
                    } else {
                        resultText = `Tool ${toolName} executed successfully.`;
                    }
                } else {
                    resultText = `Tool ${toolName} failed: ${result.error || 'Unknown error'}`;
                }
                return resultText;
            }
        } catch (error) {
            console.error(`Error executing tool ${toolCallData.name}:`, error.message);
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
            } catch (error) {
                console.error(`LLM Stream Error: ${error.message}`);
            }
            this.print('\n');
            // this.print(JSON.stringify(response));
            // TODO Do not place thinking content into the context.
            currentMessages.push({
                role: 'assistant',
                content: response.content,
            });

            // Check if LLM provided any tool calls in its response
            let toolCalls = this.parseToolCalls(response.content);

            //this.print(JSON.stringify(toolCalls));
            if (toolCalls.length > 0) {
                hasToolCalls = true;
                for (const toolCall of toolCalls) {
                    const result = await this.processToolCall(toolCall, currentMessages);

                    if (result) {
                        const msg = {
                            role: 'tool',
                            content: result,
                        };
                        currentMessages.push(msg);
                    }
                }
            }
        }
        if (!this.singleShot) {
            this.showUserPrompt();
        }
        return;
    }

    /**
     * Stop the current request in progress
     */
    stopRequest() {
        this.llm.stopRequest();

        // Remove the last element from messages (the user message that was being processed)
        if (this.messages && this.messages.length > 0) {
            const lastMessage = this.messages.pop();
            this.print('\n🛑 Removed last message from conversation:', lastMessage.content);
        }
    }
}

module.exports = Agent;
