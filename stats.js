class Stats {
    constructor(onUpdate) {
        this.stats = {
            timeToFirstToken: null,
            evalTime: 0,
            promptProcessingPerSecond: 0,
            tokenGenerationPerSecond: 0,
            promptTokens: 0,
            promptCachedTokens: 0,
            completionTokens: 0,
        };
        this.onUpdate = onUpdate;

        this.startTime = null;
        this.firstTokenTime = null;
        this.totalTokens = 0;
        this.promptCount = 0;

        this.lastDisplayTime = null;
        this.lastTokensPerSecond = 0;
        // usage data
    }

    start() {
        this.startTime = Date.now();
        this.totalTokens = 0;
        this.firstTokenTime = null;
    }

    end() {
        this.calculateFinalStats();
        //this.displayStats();
    }

    usage(data) {
        if (data) {
            this.stats.promptTokens = data.prompt_tokens;
            this.stats.promptCachedTokens = data.prompt_tokens_details?.cached_tokens;
            this.stats.completionTokens = data.completion_tokens;
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
            // Update status bar with tokens per second
            this.onUpdate({
                tokensPerSecond: this.lastTokensPerSecond,
                totalTokens: this.totalTokens,
            });
        }
    }

    calculateFinalStats() {
        if (this.startTime === null) return;

        const evalTime = Date.now() - this.startTime;
        this.stats.evalTime = evalTime;
        this.stats.tokenGenerationPerSecond = this.stats.completionTokens / (evalTime / 1000);

        const promptProcessingTime = this.firstTokenTime - this.startTime;
        if (promptProcessingTime > 0) {
            this.stats.promptProcessingPerSecond =
                (this.stats.promptTokens - this.stats.promptCachedTokens) /
                (promptProcessingTime / 1000);
        } else {
            this.stats.promptProcessingPerSecond = 0;
        }
    }

    displayStats() {
        console.log(`\n📊 Final Stats:`);
        console.log(`- Time to first token: ${this.stats.timeToFirstToken}ms`);
        console.log(`- Eval time: ${this.stats.evalTime}ms`);

        console.log(
            `- Prompt tokens: ${this.stats.promptTokens} (${this.stats.promptCachedTokens}) `,
        );
        console.log(`- Generated tokens: ${this.stats.completionTokens}`);
        console.log(
            `- Prompt processing: ${this.stats.promptProcessingPerSecond.toFixed(2)} tokens/sec`,
        );
        console.log(
            `- Token generation: ${this.stats.tokenGenerationPerSecond.toFixed(2)} tokens/sec`,
        );
    }
}

module.exports = Stats;
