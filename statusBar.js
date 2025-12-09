class StatusBar {
    constructor(onUpdate) {
        this.state = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            tokensPerSecond: 0,
            lastTokenTime: null,
            currentlyRunningTool: null,
            model: null,
            status: 'Ready',
        };
        this.lastUpdate = Date.now();
        this.tokenCount = 0;
        this.onUpdate = onUpdate;
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

    // Update state with info object
    updateState(info) {
        // Copy all properties from info to this.state
        for (const key in info) {
            if (info.hasOwnProperty(key)) {
                this.state[key] = info[key];
            }
        }
        // Trigger update if needed
        this.onUpdate(this.getText());
    }

    // Get formatted status text
    getText() {
        const {
            promptTokens,
            completionTokens,
            totalTokens,
            tokensPerSecond,
            currentlyRunningTool,
            model,
            status,
        } = this.state;

        let text = `Tokens: ${promptTokens} (P) / ${completionTokens} (C) / ${totalTokens} (T)`;

        if (tokensPerSecond > 0) {
            text += ` | TPS: ${tokensPerSecond.toFixed(1)}`;
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
