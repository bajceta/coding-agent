import { getDefaultModel, getConfig } from './config.ts';
import { openaiTools } from './parser-native.ts';
import type { Tools, Message, LLMResponse } from './interfaces.ts';
import Stats from './stats.ts';
import fs from 'fs';
import path from 'path';
import Log from './log.ts';

class LLM {
    modelConfig: any;
    abortController: AbortController | null;
    stats: Stats;
    config: any;
    stream: boolean;
    log: Log;

    constructor(onUpdate: (state: any) => void, log: Log) {
        this.modelConfig = getDefaultModel();
        this.stats = new Stats(onUpdate);
        this.abortController = null;
        this.config = getConfig();
        this.stream = true;
        this.log = log;
    }

    async makeRequest(
        messages: Message[],
        tools: Tools,
        onChunk: (chunk: string) => void,
        onReasoningChunk: (chunk: string) => void,
    ): Promise<LLMResponse> {
        if (this.config.logFile.length > 0) {
            const resolvedPath = path.resolve(this.config.logFile);
            messages.forEach((msg) =>
                fs.appendFileSync(resolvedPath, JSON.stringify(msg) + '\n', 'utf8'),
            );
        }
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
            tools: openaiTools(tools) || [],
            tool_choice: 'auto',
        };
        if (this.stream) {
            requestBody.stream = true;
            requestBody.stream_options = { include_usage: true };
        }

        let reader;

        try {
            this.stats.start();
            const response = await fetch(`${this.modelConfig.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.modelConfig.apiKey}`,
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });

            if (this.stream) {
                if (!response.ok) {
                    this.log.error(JSON.stringify(response));
                    this.log.error(`HTTP error! status: ${response.status}`);
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullResponse = '';
                let reasoning = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value);
                    this.stats.incrementToken();
                    //console.log(chunk);
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            this.log.debug(data);
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
                                //console.error('\nError parsing chunk:'+ e.message+'\n');
                                //console.error(data);
                            }
                        }
                    }
                }
                this.stats.end();
                //qwen3 on vllm fix
                toolcalls.forEach((toolcall) => {
                    const args = toolcall.function.arguments;
                    if (args[0] != '{') {
                        const sanitizedArgs =
                            '{' + toolcall.function.arguments.split('{').slice(1).join('{');
                        //console.log(sanitizedArgs);
                        toolcall.function.arguments = sanitizedArgs;
                    }
                });
                const _response = {
                    role: 'assistant',
                    tool_calls: toolcalls,
                    content: '' + fullResponse,
                };

                messages.push(_response);

                return {
                    stats: this.stats.stats,
                    msg: _response,
                    reasoning,
                };
            } else {
                const res = await response.json();
                try {
                    this.log.debug(JSON.stringify(res.detail?.[0] || 'No details'));
                } catch (e) {}
                this.log.debug(JSON.stringify(res));
                const msg = res.choices[0]?.message;
                messages.push(msg);
                this.log.debug(JSON.stringify(msg));
                return {
                    stats: this.stats.stats,
                    msg,
                };
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
