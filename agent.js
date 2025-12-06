const LLM = require('./llm');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { parseToolCalls, setTools } = require('./parser');
const util = require('util');

const execPromise = util.promisify(exec);

class Agent {
    constructor(rl) {
        this.llm = new LLM();
        this.tools = {};
        this.loadTools();
        this.readline = rl;
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
                        this.tools[toolName] = toolModule;
                    } catch (error) {
                        console.error(`Failed to load tool ${toolName}:`, error.message);
                    }
                }
            }
        }
        setTools(this.tools);
    }

    toolDefinitionToText(def) {
        const args = [];

        def.arguments.forEach(arg => {
            const entries = Object.entries(arg);
            args.push(entries[0][0] + ":" + entries[0][1]);
        });
        const result = `
tool_name: ${def.name}
description: ${def.description}
arguments:
${args.join('\n')}
`
        return result;
    }
    getToolDefinitions() {
        const definitions = [];
        console.log(this.tools);
        for (const [name, tool] of Object.entries(this.tools)) {
            if (tool.arguments && tool.description) {
                definitions.push({
                    name: tool.name || name,
                    description: tool.description,
                    arguments: tool.arguments
                });
            }
        }
        console.log(definitions);
        return definitions;
    }

    async executeTool(toolName, args) {
        const tool = this.tools[toolName];
        if (!tool) {
            throw new Error(`Tool ${toolName} not found`);
        }

        // For write and run command tools, we need to ask for user confirmation
        if (toolName === 'writeFile' || toolName === 'runCommand') {
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
                        resultText = `Tool ${toolName} returned: ${result.content}`;
                    } else if (result.message) {
                        resultText = `Tool ${toolName} returned: ${result.message}`;
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
        // Add system message with tool definitions if not already present
        let hasToolDefinitions = false;
        let systemMsg;
        for (const msg of messages) {
            if (msg.role === 'system')
                systemMsg = msg;
            if (msg.content.includes('tools') || msg.content.includes('functions')) {
                hasToolDefinitions = true;
            }
            break
        }
        if (!hasToolDefinitions) {
            const toolDefinitions = this.getToolDefinitions();

            if (toolDefinitions.length > 0) {
                // Add system message that indicates available tools
                systemMsg.content = systemMsg.content + `
You have access to following tools:
${toolDefinitions.map(this.toolDefinitionToText).join('\n')}
If you need information from files or system commands, use the appropriate tool.
When you need to use these tools, respond using this format:

Example task is to list files in current folder with ls.
tool_call: runCommand
command: ls
end_tool_call
Example tasks is to find text "treasure" in current folder
tool_call: findText
path: ./
text: "treasure"
end_tool_call
            `
            } else {
                console.log("found no tool definitions");
            }
            console.log(systemMsg)
        }


        // Run the LLM and capture full response
        const fullResponse = await this.llm.streamResponse(messages, (chunk) => {
            process.stdout.write(chunk);
        });

        // Check if LLM provided any tool calls in its response
        const toolCalls = parseToolCalls(fullResponse);

        if (toolCalls.length > 0) {
            console.log('\n--- Tool Calls Detected ---');

            // Process each tool call one by one
            for (const toolCall of toolCalls) {
                // Execute the tool and get result
                const result = await this.processToolCall(toolCall, messages);
                // In a more sophisticated implementation, we would:
                // 1. Add the tool result back to conversation context
                // 2. Have LLM process that result to generate final response
                // For now, just show what would happen

                if (result) {
                    console.log(`Tool execution result: ${result}`);
                    const msg = {
                        role: "tool",
                        content: result,
                    };
                    messages.push(msg)
                }
            }
        }

        return fullResponse;
    }

    // Method for advanced tool calling - processes multiple rounds of interaction
    async runWithMultiRound(messages) {
        let currentMessages = [...messages];

        // Add system message with tool definitions if not already present
        let hasToolDefinitions = false;
        for (const msg of currentMessages) {
            if (msg.role === 'system' &&
                (msg.content.includes('tools') || msg.content.includes('functions'))) {
                hasToolDefinitions = true;
                break;
            }
        }

        if (!hasToolDefinitions) {
            const toolDefinitions = this.getToolDefinitions();
            if (toolDefinitions.length > 0) {
                currentMessages.unshift({
                    role: 'system',
                    content: `You are a helpful coding assistant with access to the following tools:\n${JSON.stringify(toolDefinitions, null, 2)}\n\nWhen you need to use these tools, respond using this JSON format: {"tool_call": {"name": "tool_name", "arguments": {"arg1": "value1"}}}\n\nIf you need information from files or system commands, use the appropriate tool.`
                });
            }
        }

        // Initial LLM call
        const fullResponse = await this.llm.streamResponse(currentMessages, (chunk) => {
            process.stdout.write(chunk);
        });

        // Check for tool calls in response and process them
        const toolCalls = parseToolCalls(fullResponse);

        if (toolCalls.length > 0) {
            console.log('\n--- Processing Tool Calls ---');

            // Process each tool call and add results to conversation
            for (const toolCall of toolCalls) {
                const result = await this.processToolCall(toolCall, currentMessages);

                if (result) {
                    // In a real implementation, we'd want to add this back to the conversation
                    // This is a simplified approach for demonstration
                    console.log(`Added tool result to context: ${result.substring(0, 50)}...`);
                }
            }
        }

        return fullResponse;
    }
}

module.exports = Agent;
