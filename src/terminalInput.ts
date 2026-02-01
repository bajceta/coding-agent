import type Agent from './agent.ts';
import { readdirSync } from 'fs';

export class TerminalInputHandler {
    private agent: Agent;
    private buffer: string = '';
    private stdin: NodeJS.ReadStream;
    private userInput: string[];
    private historyIndex: number = -1; // Track position in history
    private history: string[] = []; // Store command history
    private printChunk: (chunk: string) => void;
    private printWholeBuffer: (buffer: string) => void;
    private processInput: (input: string) => void;
    private clearUserInput: () => void;
    private stopRequest: () => void;
    private prompt: ((value: string) => void) | null = null;
    private fileSelect: boolean;

    constructor(
        printChunk: (chunk: string) => void,
        printWholeBuffer: (buffer: string) => void,
        processInput: (input: string) => void,
        clearUserInput: () => void,
        stopRequest: () => void,
        agent?: Agent,
    ) {
        this.stdin = process.stdin;
        this.printChunk = printChunk;
        this.printWholeBuffer = printWholeBuffer;
        this.processInput = processInput;
        this.clearUserInput = clearUserInput;
        this.stopRequest = stopRequest;
        this.agent = agent;
        this.userInput = [];
        this.fileSelect = false;
    }

    fileSelectMode(state) {
        this.fileSelect = state;
        this.agent.window.setSelector([]);
    }

    waitPrompt(): Promise<string> {
        this.buffer = '';
        return new Promise((resolve) => {
            this.prompt = resolve;
        });
    }

    setup() {
        if (!this.stdin.isTTY) {
            return;
        }
        this.stdin.setRawMode(true);
        this.stdin.resume();
        this.stdin.setEncoding('utf8');

        let fileList = [];

        let escCount: number = 0;
        this.stdin.on('data', (chunk: string) => {
            const code = chunk.charCodeAt(0);

            // ESC key is ASCII 27
            if (code === 13) {
                this.fileSelectMode(false);
                // ENTER key (CR)
                if (this.prompt) {
                    this.prompt(this.buffer);
                    this.prompt = null;
                } else {
                    if (this.buffer.length > 0) {
                        this.history.push(this.buffer);
                    }
                    this.processInput(this.buffer);
                    this.buffer = '';
                    this.historyIndex = -1; // Reset history index
                    this.printWholeBuffer(this.buffer);
                }
                this.buffer = '';
                return;
            }

            if (code === 0x7f || code === 0x08) {
                // Backspace (DEL or BS)
                if (this.buffer.length > 0) {
                    this.buffer = this.buffer.slice(0, -1); // Remove last character
                    this.printChunk('\x08 \x08'); // Move cursor back, clear, move back
                    this.printWholeBuffer(this.buffer);
                }
                return;
            }
            if (code === 0x03) {
                // Ctrl+C
                // console.log('\nExiting...');
                process.exit(0);
            }

            if (code === 10 && chunk === '\n') {
                // Raw mode still emits LF sometimes, but Enter is CR above (13)
                // So treat plain LF only as typed text
                this.buffer += '\n';
                this.printChunk('\n');
                this.printWholeBuffer(this.buffer);
                return;
            }

            if (code === 10 && this.stdin.isRaw) {
                // Ctrl+J generates LF (10)
                this.buffer += '\n';
                this.printChunk('\n');
                this.printWholeBuffer(this.buffer);
                return;
            }

            // Handle up arrow key (ESC[A or \x1b[A)
            if (chunk === '\x1b[A' || chunk === '\x1b[1;5A') {
                if (this.history.length > 0) {
                    if (this.historyIndex === -1) {
                        // First time accessing history, save current buffer
                        this.historyIndex = this.history.length - 1;
                    } else if (this.historyIndex > 0) {
                        // Move up in history
                        this.historyIndex--;
                    } else {
                        // Already at oldest item
                        return;
                    }

                    // Replace buffer with history item
                    this.buffer = this.history[this.historyIndex];
                    this.clearUserInput();
                    this.printChunk(this.buffer);
                    this.printWholeBuffer(this.buffer);
                }
                return;
            }

            // Handle down arrow key (ESC[B or \x1b[B)
            if (chunk === '\x1b[B' || chunk === '\x1b[1;5B') {
                if (this.history.length > 0 && this.historyIndex !== -1) {
                    if (this.historyIndex < this.history.length - 1) {
                        // Move down in history
                        this.historyIndex++;
                        this.buffer = this.history[this.historyIndex];
                    } else {
                        // At newest item, clear buffer
                        this.historyIndex = -1;
                        this.buffer = '';
                    }
                    this.clearUserInput();
                    this.printChunk(this.buffer);
                    this.printWholeBuffer(this.buffer);
                }
                return;
            }

            // Handle Ctrl+Y key (ASCII 25)
            if (code === 25) {
                if (this.agent) {
                    this.agent.toggleYoloMode();
                }
                return;
            }

            if (code === 27) {
                escCount++;
                if (escCount >= 2) {
                    this.printChunk('\n🛑 Stopping request...');
                    this.stopRequest(); // Call the agent's stop method
                    escCount = 0; // Reset counter
                } else {
                    this.printChunk('\n⚠️ Press ESC again to stop current request');
                }
            } else {
                escCount = 0; // Reset if any other key is pressed
            }

            // whitespace
            if (code === 27) {
                if (this.fileSelect) {
                }
            }

            // Handle @ symbol
            if (chunk === '@') {
                this.fileSelectMode(true);
            }

            //tab
            if (code === 9) {
                if (this.fileSelect) {
                    const parts = this.buffer.split('@');
                    parts.pop();
                    parts.push(fileList[0]);
                    this.buffer = parts.join('@');
                }
            }

            this.buffer += chunk;

            if (this.fileSelect) {
                const filename = this.buffer.split('@').pop();
                try {
                    const files = readdirSync('.');
                    if (filename != '') {
                        fileList = files.filter((file) => file.includes(filename));
                    } else {
                        fileList = files.slice(0, 10);
                    }
                    if (this.agent && this.agent.window) {
                        this.agent.window.setSelector(fileList);
                    }
                } catch (error) {
                    console.error('Error reading directory:', error);
                }
            }

            // Normal characters
            this.printChunk(chunk);
            this.printWholeBuffer(this.buffer);
        });

        this.stdin.on('end', () => {
            if (this.agent) {
                this.agent.print('\nInput ended');
            }
            console.log('\nInput ended');
        });
    }
}
