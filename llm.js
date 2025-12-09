const { getDefaultModel } = require('./config');
const Stats = require('./stats');

class LLM {
    constructor(onUpdate) {
        console.log(onUpdate);
        this.modelConfig = getDefaultModel();
        this.abortController = null;
        this.stats = new Stats(onUpdate);
    }

    async streamResponse(messages, onChunk, onReasoningChunk) {
        const response = await this.makeRequest(messages, onChunk, onReasoningChunk);
        return response;
    }

    async makeRequest(messages, onChunk, onReasoningChunk) {
        const controller = new AbortController();
        this.abortController = controller;

        const requestBody = {
            model: this.modelConfig.model,
            messages: messages,
            temperature: 0.1,
            stream: true,
            stream_options: { include_usage: true },
        };

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
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body.getReader();
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
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data.trim() === '[DONE]') continue;

                            try {
                                const parsed = JSON.parse(data);
                                this.stats.usage(parsed.usage);
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
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
            this.stats.end();
            return {
                content: fullResponse,
                reasoning,
                stats: this.stats.stats,
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Request was cancelled by user');
            }
            throw error;
        }
    }

    stopRequest() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}

module.exports = LLM;
