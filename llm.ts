import { getDefaultModel } from './config.ts';
import { openaiTools } from './parser-native.ts';
import type { Tools, Message, LLMResponse } from './interfaces.ts';
import Stats from './stats.ts';
import fs from 'fs';
import path from 'path';

class LLM {
    modelConfig: any;
    abortController: AbortController | null;
    stats: Stats;

    constructor(onUpdate: (state: any) => void) {
        this.modelConfig = getDefaultModel();
        this.abortController = null;
        this.stats = new Stats(onUpdate);
    }

    async makeRequest(
        messages: Message[],
        tools: Tools,
        onChunk: (chunk: string) => void,
        onReasoningChunk: (chunk: string) => void,
    ): Promise<LLMResponse> {
        const resolvedPath = path.resolve('/tmp/messages');
        messages.forEach(msg =>
         fs.appendFileSync(resolvedPath, JSON.stringify(msg)+"\n", 'utf8')
        );
        const controller = new AbortController();
        this.abortController = controller;

        const toolcalls = [];
        function processToolCallStream(stream) {
            stream.forEach((part) => {
                let current;
                if (!toolcalls[part.index]) {
                    toolcalls[part.index] = part;
                    onChunk(part.function.name);
                } else {
                    current = toolcalls[part.index];
                    current.function.arguments += part.function.arguments;
                    onChunk(part.function.arguments);
                }
            });
        }
        const requestBody = {
            model: this.modelConfig.model,
            messages: messages,
            temperature: 0.1,
            stream: true,
            stream_options: { include_usage: true },
            tools: openaiTools(tools) || [],
            tool_choice: 'auto',
        };
        let reader;

        try {
            const response = await fetch(`${this.modelConfig.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.modelConfig.apiKey}`,
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });

            if (!response.ok) {
                //console.log(response);
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';
            let reasoning = '';
            this.stats.start();

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    this.stats.incrementToken();
                    const chunk = decoder.decode(value);
                    //console.log(chunk);
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data.trim() === '[DONE]') continue;

                            try {
                                const parsed = JSON.parse(data);
                                this.stats.usage(parsed.usage);
                                if (parsed.choices[0]?.delta?.tool_calls) {
                                    processToolCallStream(parsed.choices[0].delta.tool_calls);
                                }
                                const content = parsed.choices[0]?.delta?.content || '';
                                const reasoningContent =
                                    parsed.choices[0]?.delta?.reasoning_content || '';

                                if (content) {
                                    fullResponse += content;
                                    onChunk(content);
                                }
                                if (reasoningContent.length > 0) {
                                    reasoning += reasoningContent;
                                    onReasoningChunk(reasoningContent);
                                }
                            } catch (e) {
                                console.error('Error parsing chunk:', e.message);
                                console.error(data);
                            }
                        }
                    }
                }
                this.stats.end();
                const response = {
                    role: 'assistant',
                    tool_calls: toolcalls,
                    content: '' + fullResponse,
                };

                messages.push(response);

                return {
                    stats: this.stats.stats,
                    msg: response,
                    reasoning,
                };
            } catch (error) {
                if (error.name === 'AbortError') {
                    throw new Error('Request was cancelled by user');
                }
                throw error;
            }
        } finally {
            if (reader) reader.releaseLock();
        }
    }

    stopRequest() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}

export default LLM;
