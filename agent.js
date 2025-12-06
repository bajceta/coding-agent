const LLM = require('./llm');
const fs = require('fs');
const path = require('path');
const { parseToolCalls, setTools } = require('./parser');
const { systemPrompt } = require('./systemPrompt');

const safeTools=['readFile'];

class Agent {
    constructor(rl) {
        this.llm = new LLM();
        this.tools = {};
        this.loadTools();
        this.readline = rl;
        this.messages = []; // Store reference to messages array
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
        setTools(this.tools);
    }


    async executeTool(toolName, args) {
        const tool = this.tools[toolName];
        if (!tool) {
            throw new Error(`Tool ${toolName} not found`);
        }

        // For write and run command tools, we need to ask for user confirmation
        if (!safeTools.includes(toolName)) {
            const confirm = await this.askForConfirmation(toolName, args);
            if (!confirm) {
                console.log('Operation cancelled by user.');
                return null;
            }
        }

        return await tool.execute(...args);
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

            console.log(`\nExecuting tool: ${toolName}`);

            const result = await this.executeTool(toolName, args);

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


    // Enhanced run method that handles tool calls in LLM responses
    async run(messages) {
        // Store reference to messages array
        this.messages = messages;

        // Add system message with tool definitions if not already present
        systemPrompt(messages, this.tools);

        let currentMessages = messages;
        let hasToolCalls = true;

        while (hasToolCalls) {
            hasToolCalls = false;

            // Run the LLM and capture full response
            console.log("MAKE LLM REQUEST");
            console.log(currentMessages[currentMessages.length - 1]);

            const fullResponse = await this.llm.streamResponse(currentMessages, (chunk) => {
                process.stdout.write(chunk);
            }, (chunk) => {
                process.stdout.write(chunk);
            });

            currentMessages.push({
                role: 'assistant',
                content: fullResponse,
            });

            // Check if LLM provided any tool calls in its response
            const toolCalls = parseToolCalls(fullResponse);

            if (toolCalls.length > 0) {
                hasToolCalls = true;
                console.log('\n--- Tool Calls Detected ---');

                // Process each tool call one by one
                for (const toolCall of toolCalls) {
                    // Execute the tool and get result
                    const result = await this.processToolCall(toolCall, currentMessages);

                    if (result) {
                        console.log(`Tool execution result: ${result}`);
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
