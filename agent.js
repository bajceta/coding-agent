const LLM = require('./llm');
const fs = require('fs');
const path = require('path');
const { parseToolCalls, setTools, toolPrompt } = require('./parser');
const { systemPrompt } = require('./systemPrompt');
const { parseToolCalls: parseToolCallsJson, setTools: setToolsJson, toolPrompt: toolPromptJson } = require('./parser-json');

const safeTools = ['readFile'];

class Agent {
    constructor(rl, parserType = 'plain') {
        this.llm = new LLM();
        this.tools = {};
        this.parserType = parserType;
        this.parseToolCalls = parseToolCalls;
        this.toolPrompt = toolPrompt
        this.loadTools();
        this.newRequest = true;
        this.columnPos = 0;
        this.readline = rl;
        this.messages = []; // Store reference to messages array
        if (parserType === "json") {
            this.parseToolCalls = parseToolCallsJson;
            this.toolPrompt = toolPromptJson;
        }
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
        console.log(`Loaded ${Object.keys(this.tools).length} tools`);
    }

    async askForConfirmation(toolName, args) {

        return new Promise((resolve) => {
            this.readline.question(
                `Execute ${toolName} with args: ${JSON.stringify(args)}? (y/n): `,
                (answer) => {
                    resolve(/^y(es)?$/i.test(answer));
                }
            );
        });
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

            // For write and run command tools, we need to ask for user confirmation
            if (!safeTools.includes(toolName)) {
                const confirm = await this.askForConfirmation(toolName, args);
                if (!confirm) {
                    console.log('Operation cancelled by user.');
                    return `Tool ${toolName} rejected by user`;
                }
            }

            const result = await tool.execute(...args);
            if (result.error) {
                console.log("Tool call error: " + result.error);
            }

            if (result !== null) { // Only proceed if execution was confirmed
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

    newline() {
        const rows = process.stdout.rows;
        const statusRow = rows;  // Last row (status bar)
        const textAreaBottom = rows - 1; // Row above status bar
        //Clean status bar
        process.stdout.write(`\x1b[${statusRow};0H\x1b[K`);
        // Shift screen up to make room for new text
        process.stdout.write('\x1b[1S');
        // Move cursor to bottom of text area (above status bar)
        process.stdout.write(`\x1b[${textAreaBottom};0H`);
        this.columnPos = 0;
    }

    printAddToLine(chunk) {
        const columns = process.stdout.columns;
        if ((this.columnPos + chunk.length) > columns) {
            this.newline();
        }
        process.stdout.write(chunk);
        this.columnPos += chunk.length;
    }

    printChunk(chunk) {
        if (this.newRequest) {
            this.newline()
            this.newRequest = false;
        }
        if (chunk.includes('\n')) {
            const lines = chunk.split('\n');
            this.printAddToLine(lines[0]);
            for (const line of lines) {
                this.newline()
                this.printAddToLine(lines[0]);
            }
        } else {
            this.printAddToLine(chunk);
        }
    }

    // Enhanced run method that handles tool calls in LLM responses
    async run(messages) {
        // Store reference to messages array
        this.messages = messages;
        // Add system message with tool definitions if not already present
        systemPrompt(messages, this.tools, this.toolPrompt);

        let currentMessages = messages;
        let hasToolCalls = true;

        while (hasToolCalls) {
            hasToolCalls = false;

            // Run the LLM and capture full response
            //console.log("MAKE LLM REQUEST");
            //console.log(currentMessages[currentMessages.length - 1]);

            let fullResponse;

            try {
                this.newRequest = true;
                fullResponse = await this.llm.streamResponse(
                    currentMessages,
                    this.printChunk.bind(this),
                    (chunk) => process.stdout.write('\x1b[31m' + chunk + '\x1b[0m')
                );


            } catch (error) {
                console.error(`LLM Stream Error: ${error.message}`);
            }

            // TODO Do not place thinking content into the context.

            currentMessages.push({
                role: 'assistant',
                content: fullResponse,
            });

            // Check if LLM provided any tool calls in its response
            let toolCalls = [];
            toolCalls = this.parseToolCalls(fullResponse);


            if (toolCalls.length > 0) {
                hasToolCalls = true;
                console.log('\n--- Tool Calls Detected ---');

                // Process each tool call one by one
                for (const toolCall of toolCalls) {
                    // Execute the tool and get result
                    const result = await this.processToolCall(toolCall, currentMessages);

                    if (result) {
                        const msg = {
                            role: "tool",
                            content: result,
                        };
                        currentMessages.push(msg);
                    }
                }
            }
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
            console.log('\n🛑 Removed last message from conversation:', lastMessage.content);
        }
    }
}

module.exports = Agent;
