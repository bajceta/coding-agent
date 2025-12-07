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
        const requestBody = {
            model: this.modelConfig.model,
            messages: messages,
            // "top_k": 20,
            "temperature": 0.1,
            // "repetition_penalty": 2.1,
            // "presence_penalty": 1.0,
            stream: true
        };

        try {
            const response = await fetch(`${this.modelConfig.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.modelConfig.apiKey}`
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';
            let startTime = null;
            let totalTokens = 0;
            const promptCount = messages.length;

            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6); // Remove 'data: ' prefix
                            if (data.trim() === '[DONE]') continue;

                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed.choices[0]?.delta?.content || '';
                                const reasoningContent = parsed.choices[0]?.delta?.reasoning_content || '';

                                if (content || reasoningContent) {
                                    // Start timing on first chunk
                                    if (!startTime) startTime = Date.now();
                                    totalTokens++;

                                    const currentTime = Date.now();
                                    const elapsedSeconds = (currentTime - startTime) / 1000;
                                    let tokensPerSecond = elapsedSeconds > 0 ? totalTokens / elapsedSeconds : 0;

                                    // Save current position
                                    if (true) {
                                        process.stdout.write('\x1b[s');
                                        const rows = process.stdout.rows;
                                        const columns = 0;
                                        process.stdout.write(`\x1b[${rows};${columns}H`);

                                        // Display TPS
                                        process.stdout.write(`Tokens/s: ${tokensPerSecond.toFixed(2)}`);
                                        // Restore cursor position
                                        process.stdout.write('\x1b[u');
                                    }
                                }

                                if (content) {
                                    fullResponse += content;
                                    onChunk(content);
                                }
                                if (reasoningContent.length > 0) {
                                    onReasoningChunk(reasoningContent);
                                }
                            } catch (e) {
                                console.error('Error parsing chunk:', e.message);
                            }
                        }
                    }
                }

                // Final logging after stream completes
                if (startTime && totalTokens > 0) {
                    const elapsedSeconds = (Date.now() - startTime) / 1000;
                    const finalTps = totalTokens / elapsedSeconds;

                    //console.log(`\n\nLast message:\n${fullResponse}`);
                    //console.log(`Messages count: ${promptCount}, Speed: ${finalTps.toFixed(2)} tokens/s`);
                }

            } finally {
                reader.releaseLock();
            }

            return fullResponse;
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
