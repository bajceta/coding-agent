import { getConfig } from './config.ts'; // Import config singleton
import eventBus from './eventBus.ts';

// Navigation mode type (vim-like: normal for command mode, insert for editing)
export type NavigationMode = 'normal' | 'insert';

// Execution mode type (read/write/run for file access)
export type ExecutionMode = 'read' | 'write' | 'run';

interface StatusBarState {
    promptTokens: number;
    completionTokens?: number;
    promptCachedTokens: number;
    totalTokens: number;
    tokensPerSecond: number;
    promptProcessingPerSecond: number;
    lastTokenTime: number | null;
    currentlyRunningTool: string | null;
    model: string | null;
    status: string;
    executionMode: ExecutionMode;
    navigationMode: NavigationMode;
}

interface UpdateCallback {
    (text: string): void;
}

/**
 * ANSI color codes for text formatting
 */
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

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
            promptProcessingPerSecond: 0,
            lastTokenTime: null,
            currentlyRunningTool: null,
            model: null,
            status: 'Ready',
            executionMode: 'read',
            navigationMode: 'normal',
        };
        const config = getConfig();
        this.state.executionMode = config.executionMode;
        this.lastUpdate = Date.now();
        this.tokenCount = 0;
        this.onUpdate = onUpdate;
        this.onUpdate(this.getText());

        // Listen for execution mode changes (read/write/run)
        eventBus.on('mode', (mode: ExecutionMode) => {
            this.state.executionMode = mode;
            this.onUpdate(this.getText());
        });

        // Listen for navigation mode changes (normal/insert)
        eventBus.on('navigation_mode', (mode: NavigationMode) => {
            this.state.navigationMode = mode;
            this.onUpdate(this.getText());
        });

        eventBus.on('update_status_bar', (args) => this.updateState(args));
    }

    setTool(toolName: string): void {
        this.state.currentlyRunningTool = toolName;
    }

    clearTool(): void {
        this.state.currentlyRunningTool = null;
    }

    setStatus(status: string): void {
        this.state.status = status;
    }

    setNavigationMode(mode: NavigationMode): void {
        this.state.navigationMode = mode;
        this.onUpdate(this.getText());
    }

    updateState(info: Partial<StatusBarState>): void {
        for (const key in info) {
            if (info.hasOwnProperty(key)) {
                this.state[key] = info[key];
            }
        }
        this.onUpdate(this.getText());
    }

    getText(): string {
        const {
            promptTokens,
            promptCachedTokens,
            totalTokens,
            tokensPerSecond,
            promptProcessingPerSecond,
            currentlyRunningTool,
            model,
            status,
            executionMode,
            navigationMode,
        } = this.state;

        let text = '';

        // Show BOTH modes: execution mode (blue) | navigation mode (magenta)
        text += `${BLUE}${executionMode.toUpperCase()}${RESET}`;
        text += ` | ${MAGENTA}${navigationMode.toUpperCase()}${RESET} `;

        // Tokens count
        text += `| ${GREEN}Tokens: ${promptTokens}(P) ${promptCachedTokens}(C) ${totalTokens}(T)${RESET}`;

        // Tokens per second
        if (tokensPerSecond > 0) {
            text += ` | ${BLUE}TPS: ${tokensPerSecond.toFixed(1)}${RESET}`;
        }

        // Prompt processing tokens per second
        if (promptProcessingPerSecond > 0) {
            text += ` | ${MAGENTA}PPS: ${promptProcessingPerSecond.toFixed(1)}${RESET}`;
        }

        // Currently running tool
        if (currentlyRunningTool) {
            text += ` | ${YELLOW}Tool: ${currentlyRunningTool}${RESET}`;
        }

        // Status message
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

        // Model name
        if (model) {
            text += ` | ${CYAN}Model: ${model}${RESET}`;
        }
        return text;
    }
}

export default StatusBar;
