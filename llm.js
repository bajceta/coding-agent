const { getDefaultModel } = require('./config');

class LLM {
    constructor() {
        this.modelConfig = getDefaultModel();
        this.abortController = null;
    }

    async streamResponse(messages, onChunk, onReasoningChunk) {
        const response = await this.makeRequest(messages, onChunk, onReasoningChunk);
        return response;
    }

    async makeRequest(messages, onChunk, onReasoningChunk) {
        const controller = new AbortController();
        this.abortController = controller;

        // Initialize stats
        const stats = {
            timeToFirstToken: null,
            evalTime: 0,
            promptProcessingPerSecond: 0,
            tokenGenerationPerSecond: 0,
        };

        const requestBody = {
            model: this.modelConfig.model,
            messages: messages,
            temperature: 0.1,
            stream: true,
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
            let startTime = Date.now();
            let firstTokenTime = null;
            let totalTokens = 0;
            const promptCount = messages.length;

            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (firstTokenTime === null) {
                            firstTokenTime = Date.now();
                            stats.timeToFirstToken = firstTokenTime - startTime;
                        }
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6); // Remove 'data: ' prefix
                            if (data.trim() === '[DONE]') continue;

                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed.choices[0]?.delta?.content || '';
                                const reasoningContent =
                                    parsed.choices[0]?.delta?.reasoning_content || '';

                                totalTokens++;

                                const currentTime = Date.now();
                                const elapsedSeconds = (currentTime - firstTokenTime) / 1000;
                                let tokensPerSecond =
                                    elapsedSeconds > 0 ? totalTokens / elapsedSeconds : 0;
                                stats.tokensPerSecond = tokensPerSecond;
                                // Save current position
                                process.stdout.write('\x1b[s');
                                const rows = process.stdout.rows;
                                const columns = 0;
                                process.stdout.write(`\x1b[${rows};${columns}H`);

                                // Display TPS
                                process.stdout.write(`Tokens/s: ${tokensPerSecond.toFixed(2)}`);
                                // Restore cursor position
                                process.stdout.write('\x1b[u');

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

                // Calculate final stats after stream completes
                if (startTime && totalTokens > 0) {
                    const evalTime = Date.now() - startTime;
                    stats.evalTime = evalTime;
                    stats.tokenGenerationPerSecond = totalTokens / (evalTime / 1000);

                    // Calculate prompt processing per second
                    const promptProcessingTime = firstTokenTime - startTime;
                    if (promptProcessingTime > 0) {
                        stats.promptProcessingPerSecond =
                            promptCount / (promptProcessingTime / 1000);
                    } else {
                        stats.promptProcessingPerSecond = 0;
                    }
                }
            } finally {
                reader.releaseLock();
            }

            // Return response with stats
            return {
                content: fullResponse,
                reasoning,
                stats,
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Request was cancelled by user');
            }
            throw error;
        }
    }

    /**
     * Stop the current request if one is in progress
     */
    stopRequest() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}

module.exports = LLM;
