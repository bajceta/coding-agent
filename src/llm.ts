import { getDefaultModel, getConfig } from './config.ts';
import { openaiTools } from './parser-native.ts';
import type { Tools, Message, LLMResponse } from './interfaces.ts';
import Stats from './stats.ts';
import Log from './log.ts';
import eventBus from './eventBus.ts';
import https from 'node:https';
import http from 'node:http';

const log = Log.get('llm');

class LLM {
    modelConfig: any;
    stats: Stats;
    config: any;
    currentRequest: any;

    constructor(onUpdate: (state: any) => void) {
        this.modelConfig = getDefaultModel();
        this.stats = new Stats(onUpdate);
        this.config = getConfig();
    }

    makeRequest(messages: Message[], tools: Tools): LLMResponse {
        var resolve, reject;

        const done: Promise<boolean> = new Promise((_resolve, _reject) => {
            resolve = _resolve;
            reject = _reject;
        });

        const msg: Message = {
            role: 'assistant',
            tool_calls: [],
            content: '',
            reasoning_content: '',
        };

        const result: LLMResponse = {
            stats: this.stats.stats,
            msg,
            done,
        };

        function processToolCallStream(stream) {
            log.debug(JSON.stringify(stream));
            stream.forEach((part) => {
                let current;
                log.debug(JSON.stringify(part));
                if (!msg.tool_calls[part.index]) {
                    msg.tool_calls[part.index] = part;
                } else {
                    current = msg.tool_calls[part.index];
                    current.function.arguments += part.function.arguments;
                }
            });
        }
        const requestBody = {
            model: this.modelConfig.model,
            messages: messages,
            temperature: 0.4,
            tools: openaiTools(tools) || [],
            tool_choice: 'auto',
            parallel_tool_calls: true,
        };
        if (this.config.stream) {
            requestBody['stream'] = true;
            requestBody['stream_options'] = { include_usage: true };
        }

        try {
            this.stats.start();
            const postData = JSON.stringify(requestBody);
            const options = {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.modelConfig.apiKey}`,
                },
                method: 'POST',
            };

            var raw = '';
            log.info(`options: ${JSON.stringify(options)}`);
            log.info(`url: ${this.modelConfig.baseUrl} `);

            var client: any = http;
            if (this.modelConfig.baseUrl.startsWith('https')) client = https;
            let error = false;
            const req = client.request(
                `${this.modelConfig.baseUrl}/chat/completions`,
                options,
                (res) => {
                    //log.info(`STATUS: ${res.statusCode}`);
                    //log.info(`HEADERS: ${JSON.stringify(res.headers)}`);
                    if (res.statusCode > 299) error = true;
                    res.setEncoding('utf8');

                    res.on('data', (value) => {
                        //log.info(`BODY: ${value}`);
                        if (this.config.stream) {
                            //const chunk = decoder.decode(value);
                            this.stats.incrementToken();
                            const lines = value.split('\n');
                            for (const line of lines) {
                                if (line.startsWith('data: ')) {
                                    const data = line.slice(6);
                                    log.trace(data);
                                    if (data.trim() === '[DONE]') continue;

                                    try {
                                        const parsed = JSON.parse(data);
                                        this.stats.usage(parsed.usage);
                                        if (parsed.choices[0]?.delta?.tool_calls) {
                                            processToolCallStream(
                                                parsed.choices[0].delta.tool_calls,
                                            );
                                        }
                                        const content = parsed.choices[0]?.delta?.content || '';
                                        const reasoningContent =
                                            parsed.choices[0]?.delta?.reasoning || '';
                                        //   parsed.choices[0]?.delta?.reasoning_content || '';

                                        if (content) {
                                            msg.content += content;
                                        }
                                        if (reasoningContent) {
                                            msg.reasoning_content += reasoningContent;
                                        }
                                        eventBus.emit('render');
                                    } catch (error) {
                                        log.error(
                                            'Failed parsing: ' + data + ' error ' + error.message,
                                        );
                                    }
                                }
                            }
                        } else {
                            raw += value;
                        }
                    });

                    res.on('end', () => {
                        if (error) {
                            this.currentRequest = null;
                            reject(error);
                            return;
                        }

                        log.info('No more data in response.');
                        this.stats.end();
                        if (this.config.stream) {
                            //qwen3 on vllm fix
                            msg.tool_calls.forEach((toolcall) => {
                                const args = toolcall.function.arguments;
                                if (args && args[0] != '{') {
                                    const sanitizedArgs =
                                        '{' +
                                        toolcall.function.arguments.split('{').slice(1).join('{');
                                    toolcall.function.arguments = sanitizedArgs;
                                }
                            });
                        }

                        if (!this.config.stream) {
                            console.log(raw);
                            const _res = JSON.parse(raw);
                            try {
                                console.log(_res); //handle 404 and other errors here
                                log.debug(JSON.stringify(_res.detail?.[0] || 'No details'));
                            } catch {}
                            log.debug(JSON.stringify(_res));
                            const m = _res.choices[0]?.message;
                            result.msg.content = m.content;
                            result.msg.tool_calls = m.tool_calls;
                            result.msg.reasoning = m.reasoning;
                            result.msg.reasoning_content = m.reasoning_content;
                        }
                        resolve(true);
                        this.currentRequest = null;
                    });
                },
            );

            this.currentRequest = req;

            req.on('error', (e) => {
                error = true;
                log.error(`problem with request: ${e.message}`);
                log.error(JSON.stringify(e));
                reject(e);
                this.currentRequest = null;
                //log.error(`HTTP error! status: ${response.status}`);
                //throw new Error(`HTTP error! status: ${response.status}`);
            });

            req.write(postData);
            req.end();
        } catch (err) {
            log.error(err);
        }
        return result;
    }

    stopRequest() {
        if (this.currentRequest) {
            this.currentRequest.abort();
            this.currentRequest = null;
        }
    }

    /**
     * Fetches available models from the OpenAI-compatible /v1/models endpoint.
     * @returns Promise with the models data
     */
    async fetchModels(): Promise<any> {
        try {
            log.info(`${this.modelConfig.baseUrl}/models`);
            const response = await fetch(`${this.modelConfig.baseUrl}/models`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.modelConfig.apiKey}`,
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            log.error(
                `Error fetching models: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
            log.error(`${error.stack}`);
            log.error(`${error.cause}`);
            log.error(`${error.cause.stack}`);
            throw error;
        }
    }

    /**
     * Updates the model configuration for this LLM instance.
     * @param modelConfig The new model configuration
     */
    updateModelConfig(modelConfig: any): void {
        this.config.models[0].model = modelConfig.id;
        eventBus.emit('update_status_bar', { model: this.config.models[0].model });
    }
}

export default LLM;
