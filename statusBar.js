class StatusBar {
    constructor() {
        this.state = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            tokensPerSecond: 0,
            lastTokenTime: null,
            currentlyRunningTool: null,
            model: null,
            status: 'Ready'
        };
        this.lastUpdate = Date.now();
        this.tokenCount = 0;
    }

    // Update token stats
    updateTokens(promptTokens, completionTokens, totalTokens, model = null) {
        this.state.promptTokens = promptTokens;
        this.state.completionTokens = completionTokens;
        this.state.totalTokens = totalTokens;
        this.state.model = model;

        // Calculate tokens per second
        const now = Date.now();
        const elapsed = now - this.lastUpdate;
        if (elapsed > 0) {
            this.state.tokensPerSecond = (this.tokenCount / (elapsed / 1000)).toFixed(2);
        }
        this.lastUpdate = now;
        this.tokenCount = totalTokens;
    }

    // Set currently running tool
    setTool(toolName) {
        this.state.currentlyRunningTool = toolName;
    }

    // Clear tool status
    clearTool() {
        this.state.currentlyRunningTool = null;
    }

    // Set general status message
    setStatus(status) {
        this.state.status = status;
    }

    // Get formatted status text
    getText() {
        const { promptTokens, completionTokens, totalTokens, tokensPerSecond, currentlyRunningTool, model, status } = this.state;

        let text = `Tokens: ${promptTokens} (P) / ${completionTokens} (C) / ${totalTokens} (T)`;

        if (tokensPerSecond > 0) {
            text += ` | TPS: ${tokensPerSecond}`;
        }

        if (currentlyRunningTool) {
            text += ` | Tool: ${currentlyRunningTool}`;
        }

        if (model) {
            text += ` | Model: ${model}`;
        }

        if (status) {
            text += ` | ${status}`;
        }

        return text;
    }
}

module.exports = StatusBar;