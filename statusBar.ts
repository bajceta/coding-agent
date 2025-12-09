interface StatusBarState {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    tokensPerSecond: number;
    lastTokenTime: number | null;
    currentlyRunningTool: string | null;
    model: string | null;
    status: string;
}

interface UpdateCallback {
    (text: string): void;
}

class StatusBar {
    state: StatusBarState;
    lastUpdate: number;
    tokenCount: number;
    onUpdate: UpdateCallback;

    constructor(onUpdate: UpdateCallback) {
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
    setTool(toolName: string): void {
        this.state.currentlyRunningTool = toolName;
    }

    // Clear tool status
    clearTool(): void {
        this.state.currentlyRunningTool = null;
    }

    // Set general status message
    setStatus(status: string): void {
        this.state.status = status;
    }

    // Update state with info object
    updateState(info: Partial<StatusBarState>): void {
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
    getText(): string {
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

export default StatusBar;
