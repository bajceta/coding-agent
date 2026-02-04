import { readdirSync } from 'fs';
import eventBus from './eventBus.ts';

export class TerminalInputHandler {
    private buffer: string = '';
    private stdin: NodeJS.ReadStream;
    private userInput: string[];
    private historyIndex: number = -1; // Track position in history
    private history: string[] = []; // Store command history
    private printChunk: (chunk: string) => void;
    private printWholeBuffer: (buffer: string) => void;
    private clearUserInput: () => void;
    private fileSelect: boolean;
    private mode: 'normal' | 'insert' = 'normal';

    constructor(
        printChunk: (chunk: string) => void,
        printWholeBuffer: (buffer: string) => void,
        clearUserInput: () => void,
    ) {
        this.stdin = process.stdin;
        this.printChunk = printChunk;
        this.printWholeBuffer = printWholeBuffer;
        this.clearUserInput = clearUserInput;
        this.userInput = [];
        this.fileSelect = false;
    }

    fileSelectMode(state) {
        this.fileSelect = state;
        eventBus.emit('selector', []);
    }

    setMode(mode: 'normal' | 'insert') {
        this.mode = mode;
        eventBus.emit('mode', mode);
        eventBus.emit('selector', []);
    }

    setup() {
        if (!this.stdin.isTTY) {
            return;
        }
        this.stdin.setRawMode(true);
        this.stdin.resume();
        this.stdin.setEncoding('utf8');

        let fileList = [];

        this.stdin.on('data', (chunk: string) => {
            const code = chunk.charCodeAt(0);

            if (code === 0x03) {
                // Ctrl+C
                eventBus.emit('exit');
            }

            // ESC to exit insert mode when in insert mode
            if (code === 27) {
                this.setMode('normal');
                return;
            }

            // Mode handling
            if (this.mode === 'normal') {
                // 'i' to enter insert mode
                if (code === 105) {
                    // ASCII for 'i'
                    this.setMode('insert');
                    return;
                }

                // 'j' to scroll down
                if (code === 106) {
                    // ASCII for 'j'
                    eventBus.emit('scroll', 'down');
                    return;
                }

                // 'k' to scroll up
                if (code === 107) {
                    // ASCII for 'k'
                    eventBus.emit('scroll', 'up');
                    return;
                }

                // CTRL+j (103 + 32 = 135? Actually CTRL+j is 135 in raw mode, or we can check chunk)
                if (code === 135 && chunk === '\x0a') {
                    eventBus.emit('scroll', 'down');
                    return;
                }

                // CTRL+k (107 + 32 = 139? Actually CTRL+k is 139, or we can check chunk)
                if (code === 139 && chunk === '\x0b') {
                    eventBus.emit('scroll', 'up');
                    return;
                }

                if (chunk === 'q') {
                    eventBus.emit('stop_request');
                    return;
                }

                if (chunk === 'y') {
                    eventBus.emit('yoloMode');
                    return;
                }

                if (chunk === 'b') {
                    eventBus.emit('print_buffer');
                    return;
                }

                // 'm' to list models
                if (chunk === 'm') {
                    eventBus.emit('list_models');
                    return;
                }

                // Keys 1-9 to select models by number
                if (code >= 49 && code <= 57) {
                    // ASCII codes for keys 1-9 (49='1', 57='9')
                    const modelNumber = code - 48; // Convert ASCII to number (48='0')
                    eventBus.emit('select_model', modelNumber);
                    return;
                }
                return;
            }

            if (this.mode === 'insert') {
                if (code === 13) {
                    this.fileSelectMode(false);
                    // ENTER key (CR)
                    if (this.buffer.length > 0) {
                        this.history.push(this.buffer);
                    }
                    eventBus.emit('process_input', this.buffer);
                    this.buffer = '';
                    this.historyIndex = -1; // Reset history index
                    this.printWholeBuffer(this.buffer);
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
                    eventBus.emit('yoloMode');
                    return;
                }

                // Handle @ symbol
                if (chunk === '@') {
                    this.fileSelectMode(true);
                }

                // tab
                if (code === 9) {
                    if (this.fileSelect) {
                        const parts = this.buffer.split('@');
                        parts.pop();
                        parts.push(fileList[0]);
                        this.buffer = parts.join('@');
                    }
                }

                if (this.fileSelect) {
                    const filename = this.buffer.split('@').pop();
                    try {
                        const files = readdirSync('.');
                        if (filename != '') {
                            fileList = files.filter((file) => file.includes(filename));
                        } else {
                            fileList = files.slice(0, 10);
                        }
                        eventBus.emit('selector', fileList);
                    } catch (error) {
                        console.error('Error reading directory:', error);
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
                        eventBus.emit('selector', fileList);
                    } catch (error) {
                        console.error('Error reading directory:', error);
                    }
                }
                this.printChunk(chunk);
                this.printWholeBuffer(this.buffer);
            }
        });

        this.stdin.on('end', () => {
            console.log('\nInput ended');
        });
    }
}
