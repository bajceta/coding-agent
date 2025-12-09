interface StatusBarState {
    promptTokens: number;
    completionTokens: number;
    promptCachedTokens: number;
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

/**
 * ANSI color codes for text formatting
 * These are used to add color to the status bar text
 */
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m'; // Green for tokens count
const BLUE = '\x1b[34m'; // Blue for tokens per second (TPS)
const YELLOW = '\x1b[33m'; // Yellow for currently running tools
const CYAN = '\x1b[36m'; // Cyan for model information
const RED = '\x1b[31m'; // Red for error messages
const MAGENTA = '\x1b[35m'; // Magenta for other status messages

class StatusBar {
    state: StatusBarState;
    lastUpdate: number;
    tokenCount: number;
    onUpdate: UpdateCallback;

    constructor(onUpdate: UpdateCallback) {
        this.state = {
            promptTokens: 0,
            promptCachedTokens: 0,
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

    /**
     * Get formatted status text with colors
     *
     * This method formats the status bar text with appropriate colors:
     * - Tokens count: Green
     * - Tokens per second (TPS): Blue
     * - Currently running tool: Yellow
     * - Model name: Cyan
     * - Status message: Color-coded based on type (Red for errors, Green for success, Yellow for warnings, Magenta for other)
     */
    getText(): string {
        const {
            promptTokens,
            promptCachedTokens,
            completionTokens,
            totalTokens,
            tokensPerSecond,
            currentlyRunningTool,
            model,
            status,
        } = this.state;

        let text = '';

        // Tokens count - green for positive values
        text += `${GREEN}Tokens: ${promptTokens}(P) ${promptCachedTokens}(C) ${totalTokens}(T)${RESET}`;

        // Tokens per second - blue for performance metrics
        if (tokensPerSecond > 0) {
            text += ` | ${BLUE}TPS: ${tokensPerSecond.toFixed(1)}${RESET}`;
        }

        // Currently running tool - yellow for important information
        if (currentlyRunningTool) {
            text += ` | ${YELLOW}Tool: ${currentlyRunningTool}${RESET}`;
        }

        // Model name - cyan for system information
        if (model) {
            text += ` | ${CYAN}Model: ${model}${RESET}`;
        }

        // Status message - color based on status type
        if (status) {
            if (status.includes('Error') || status.includes('error')) {
                text += ` | ${RED}${status}${RESET}`;
            } else if (status.includes('Success') || status.includes('success')) {
                text += ` | ${GREEN}${status}${RESET}`;
            } else if (status.includes('Warning') || status.includes('warning')) {
                text += ` | ${YELLOW}${status}${RESET}`;
            } else {
                text += ` | ${MAGENTA}${status}${RESET}`;
            }
        }

        return text;
    }
}

export default StatusBar;
