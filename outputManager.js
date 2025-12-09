class OutputManager {
    constructor() {
        this.window = null;
    }

    setWindow(window) {
        this.window = window;
    }

    print(chunk) {
        if (this.window) {
            this.window.print(chunk);
        } else {
            process.stdout.write(chunk);
        }
    }

    // Set status text (for backward compatibility)
    setStatus(text) {
        if (this.window) {
            this.window.setStatus(text);
        }
    }

    // Update status bar with token stats
    updateStatusBar(promptTokens, completionTokens, totalTokens, model = null) {
        if (this.window) {
            this.window.getStatusBar().updateTokens(promptTokens, completionTokens, totalTokens, model);
            this.window.updateStatusBar();
        }
    }

    // Set currently running tool
    setTool(toolName) {
        if (this.window) {
            this.window.getStatusBar().setTool(toolName);
            this.window.updateStatusBar();
        }
    }

    // Clear tool status
    clearTool() {
        if (this.window) {
            this.window.getStatusBar().clearTool();
            this.window.updateStatusBar();
        }
    }

    // Set general status message
    setStatusMessage(status) {
        if (this.window) {
            this.window.getStatusBar().setStatus(status);
            this.window.updateStatusBar();
        }
    }
}

module.exports = OutputManager;