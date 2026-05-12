import { readdirSync } from 'fs';
import eventBus from './eventBus.ts';

export class TerminalInputHandler {
    private buffer: string = '';
    private stdin: NodeJS.ReadStream;
    private userInput: string[];
    private historyIndex: number = -1;
    private history: string[] = [];
    private printChunk: (chunk: string) => void;
    private printWholeBuffer: (buffer: string) => void;
    private clearUserInput: () => void;
    private fileSelect: boolean;
    private mode: 'normal' | 'insert' = 'normal';
    private fileList: string[] = [];

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

    private setFileSelectMode(state: boolean): void {
        this.fileSelect = state;
        eventBus.emit('selector', []);
    }

    private setMode(mode: 'normal' | 'insert'): void {
        this.mode = mode;
        eventBus.emit('navigation_mode', mode);
        eventBus.emit('selector', []);
    }

    private updateFileSelector(): void {
        if (!this.fileSelect) return;

        const filename = this.buffer.split('@').pop() || '';
        try {
            const files = readdirSync('.');
            this.fileList = filename
                ? files.filter((file) => file.includes(filename))
                : files.slice(0, 10);
            eventBus.emit('selector', this.fileList);
        } catch (error) {
            console.error('Error reading directory:', error);
        }
    }

    setup() {
        if (!this.stdin.isTTY) {
            return;
        }
        this.stdin.setRawMode(true);
        this.stdin.resume();
        this.stdin.setEncoding('utf8');

        this.stdin.on('data', (chunk: string) => {
            const code = chunk.charCodeAt(0);

            if (code === 0x03) {
                eventBus.emit('exit');
                return;
            }

            if (code === 27) {
                this.setMode('normal');
                return;
            }

            if (this.mode === 'normal') {
                this.handleNormalMode(code, chunk);
            } else {
                this.handleInsertMode(code, chunk);
            }
        });

        this.stdin.on('end', () => {
            console.log('\nInput ended');
        });
    }

    private handleNormalMode(code: number, chunk: string): void {
        if (code === 105) {
            this.setMode('insert');
            return;
        }

        if (code === 106 || (code === 10 && chunk === '\x0a')) {
            eventBus.emit('scroll', 'down');
            return;
        }

        if (code === 107 || (code === 11 && chunk === '\x0b')) {
            eventBus.emit('scroll', 'up');
            return;
        }

        switch (chunk) {
            case 's':
                eventBus.emit('showmore');
                break;
            case 'q':
                eventBus.emit('stop_request');
                break;
            case 'Q':
                eventBus.emit('stop_tool');
                break;
            case 'r':
                eventBus.emit('toggleMode');
                break;
            case 'y':
                eventBus.emit('confirm', 'y');
                break;
            case 'n':
                eventBus.emit('confirm', 'n');
                break;
            case 'b':
                eventBus.emit('print_buffer');
                break;
            case 'm':
                eventBus.emit('list_models');
                break;
        }
    }

    private handleInsertMode(code: number, chunk: string): void {
        if (code === 13) {
            this.setFileSelectMode(false);
            if (this.buffer.length > 0) {
                this.history.push(this.buffer);
            }
            eventBus.emit('process_input', this.buffer);
            this.buffer = '';
            this.historyIndex = -1;
            this.printWholeBuffer(this.buffer);
            return;
        }

        if (code === 0x7f || code === 0x08) {
            if (this.buffer.length > 0) {
                this.buffer = this.buffer.slice(0, -1);
                this.printChunk('\x08 \x08');
                this.printWholeBuffer(this.buffer);
            }
            return;
        }

        if (code === 10) {
            this.buffer += '\n';
            this.printChunk('\n');
            this.printWholeBuffer(this.buffer);
            return;
        }

        if (chunk === '\x1b[A' || chunk === '\x1b[1;5A') {
            this.navigateHistory(-1);
            return;
        }

        if (chunk === '\x1b[B' || chunk === '\x1b[1;5B') {
            this.navigateHistory(1);
            return;
        }

        if (code === 25) {
            eventBus.emit('toggleMode');
            return;
        }

        if (chunk === '@') {
            this.setFileSelectMode(true);
        }

        if (code === 9 && this.fileSelect && this.fileList.length > 0) {
            const parts = this.buffer.split('@');
            parts.pop();
            parts.push(this.fileList[0]);
            this.buffer = parts.join('@');
        }

        this.updateFileSelector();

        this.buffer += chunk;
        this.printChunk(chunk);
        this.printWholeBuffer(this.buffer);

        this.updateFileSelector();
    }

    private navigateHistory(direction: number): void {
        if (this.history.length === 0) return;

        if (direction === -1) {
            if (this.historyIndex === -1) {
                this.historyIndex = this.history.length - 1;
            } else if (this.historyIndex > 0) {
                this.historyIndex--;
            } else {
                return;
            }
        } else {
            if (this.historyIndex !== -1) {
                if (this.historyIndex < this.history.length - 1) {
                    this.historyIndex++;
                } else {
                    this.historyIndex = -1;
                    this.buffer = '';
                }
            }
        }

        if (this.historyIndex !== -1) {
            this.buffer = this.history[this.historyIndex];
        }

        this.clearUserInput();
        this.printChunk(this.buffer);
        this.printWholeBuffer(this.buffer);
    }
}
