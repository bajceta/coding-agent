class Stats {
    constructor() {
        this.stats = {
            timeToFirstToken: null,
            evalTime: 0,
            promptProcessingPerSecond: 0,
            tokenGenerationPerSecond: 0,
        };
        this.startTime = null;
        this.firstTokenTime = null;
        this.totalTokens = 0;
        this.promptCount = 0;

        this.lastDisplayTime = null;
        this.lastTokensPerSecond = 0;
        // usage data
        this.promptTokens = 0;
        this.promptCachedTokens = 0;
        this.completionTokens = 0;
    }

    start() {
        this.startTime = Date.now();
        this.firstTokenTime = null;
    }

    end() {
        this.calculateFinalStats();
        this.displayStats();
    }

    usage(data) {
        if (data) {
            this.promptTokens = data.prompt_tokens;
            this.promptCachedTokens = data.prompt_tokens_details?.cached_tokens;
            this.completionTokens = data.completion_tokens;
        }
    }

    recordFirstToken() {
        if (!this.firstTokenTime) {
            this.firstTokenTime = Date.now();
            this.stats.timeToFirstToken = this.firstTokenTime - this.startTime;
        }
    }

    incrementToken() {
        this.recordFirstToken();
        this.totalTokens++;
        const currentTime = Date.now();
        const elapsedSeconds = (currentTime - this.firstTokenTime) / 1000;
        const tokensPerSecond = elapsedSeconds > 0 ? this.totalTokens / elapsedSeconds : 0;

        if (this.lastDisplayTime === null || currentTime - this.lastDisplayTime > 50) {
            this.lastDisplayTime = currentTime;
            this.lastTokensPerSecond = tokensPerSecond;
            this.displayTokensPerSecond();
        }
    }

    calculateFinalStats() {
        if (this.startTime === null) return;

        const evalTime = Date.now() - this.startTime;
        this.stats.evalTime = evalTime;
        this.stats.tokenGenerationPerSecond = this.completionTokens / (evalTime / 1000);

        const promptProcessingTime = this.firstTokenTime - this.startTime;
        if (promptProcessingTime > 0) {
            this.stats.promptProcessingPerSecond =
                (this.promptTokens - this.promptCachedTokens) / (promptProcessingTime / 1000);
        } else {
            this.stats.promptProcessingPerSecond = 0;
        }
    }

    displayTokensPerSecond() {
        const rows = process.stdout.rows;
        const columns = process.stdout.columns;
        process.stdout.write('\x1b[s'); // Save cursor position
        process.stdout.write(`\x1b[${rows};1H`); // Move to bottom row, column 1 (0-indexed, so 1 is first column)
        process.stdout.write(`Tokens/s: ${this.lastTokensPerSecond.toFixed(2)}`);
        process.stdout.write('\x1b[u'); // Restore cursor position
    }

    displayStats() {
        console.log(`\n📊 Final Stats:`);
        console.log(`- Time to first token: ${this.stats.timeToFirstToken}ms`);
        console.log(`- Eval time: ${this.stats.evalTime}ms`);

        console.log(`- Prompt tokens: ${this.promptTokens} (${this.promptCachedTokens}) `);
        console.log(`- Generated tokens: ${this.completionTokens}`);
        console.log(
            `- Prompt processing: ${this.stats.promptProcessingPerSecond.toFixed(2)} tokens/sec`,
        );
        console.log(
            `- Token generation: ${this.stats.tokenGenerationPerSecond.toFixed(2)} tokens/sec`,
        );
    }
}

module.exports = Stats;
