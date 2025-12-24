interface StatsData {
    timeToFirstToken: number | null;
    evalTime: number;
    promptProcessingPerSecond: number;
    tokenGenerationPerSecond: number;
    promptTokens: number;
    promptCachedTokens: number;
    completionTokens: number;
    oldTokens: number;
    totalGenerated: number;
}

interface UpdateCallback {
    (state: any): void;
}

class Stats {
    stats: StatsData;
    onUpdate: UpdateCallback;
    startTime: number | null;
    firstTokenTime: number | null;
    totalTokens: number;
    promptCount: number;
    lastDisplayTime: number | null;
    lastTokensPerSecond: number;

    constructor(onUpdate: UpdateCallback) {
        this.stats = {
            timeToFirstToken: null,
            evalTime: 0,
            promptProcessingPerSecond: 0,
            tokenGenerationPerSecond: 0,
            promptTokens: 0,
            promptCachedTokens: 0,
            completionTokens: 0,
            oldTokens: 0,
            totalGenerated: 0,
        };

        this.onUpdate = onUpdate;
        this.startTime = null;
        this.firstTokenTime = null;
        this.totalTokens = 0;
        this.promptCount = 0;
        this.lastDisplayTime = null;
        this.lastTokensPerSecond = 0;
    }

    start(): void {
        this.startTime = Date.now();
        this.totalTokens = 0;
        this.stats.oldTokens = this.stats.promptTokens;
        this.firstTokenTime = null;
    }

    end(): void {
        this.stats.totalGenerated += this.totalTokens;
        //this.displayStats();
    }

    usage(data: any): void {
        if (data) {
            this.stats.promptTokens = data.prompt_tokens;
            this.stats.promptCachedTokens =
                data.prompt_tokens_details?.cached_tokens || this.stats.oldTokens;
            this.stats.completionTokens = data.completion_tokens;
            this.calculateFinalStats();
        }
    }

    recordFirstToken(): void {
        if (!this.firstTokenTime) {
            this.firstTokenTime = Date.now();
            this.stats.timeToFirstToken = this.firstTokenTime - this.startTime!;
        }
    }

    incrementToken(): void {
        this.recordFirstToken();
        this.totalTokens++;
        const currentTime = Date.now();
        const elapsedSeconds = (currentTime - this.firstTokenTime!) / 1000;
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

    calculateFinalStats(): void {
        if (this.startTime === null) return;

        const evalTime = Date.now() - this.startTime;
        this.stats.evalTime = evalTime;
        this.stats.tokenGenerationPerSecond = this.stats.completionTokens / (evalTime / 1000);

        const effectivePromptTokens =
            this.stats.promptTokens - (this.stats.promptCachedTokens || 0);
        this.stats.promptProcessingPerSecond =
            effectivePromptTokens / (this.stats.timeToFirstToken / 1000);
    }

    displayStats(): void {
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

export default Stats;
