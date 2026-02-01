import StatusBar from './statusBar.ts';
import { TerminalInputHandler } from './terminalInput.ts';

class Window {
    columnPos: number;
    statusText: string;
    statusBar: StatusBar;
    useInk: boolean;
    userLines: number;
    agentLines: number;
    inputHandler: TerminalInputHandler;
    ready: boolean;
    buffer: string[];
    bufferOffset: number;
    userInput: string;
    selector: string[];

    constructor(processInput: (text) => void, stopRequest, useInk: boolean = true, agent?: any) {
        this.columnPos = 0;
        this.userLines = 0;
        this.agentLines = 0;
        this.statusText = '';
        this.statusBar = new StatusBar(this.setStatus.bind(this));
        this.useInk = useInk;
        this.ready = false;
        this.buffer = [''];
        this.bufferOffset = 0;
        this.userInput = '';
        this.selector = [];

        const nop = () => {};
        const setUserInput = this.setUserInput.bind(this);
        this.inputHandler = new TerminalInputHandler(
            nop,
            setUserInput,
            processInput,
            nop,
            stopRequest,
            agent,
        );
        this.inputHandler.setup();
    }

    setReady(): void {
        this.ready = true;
    }

    // Render status bar (called internally)
    renderStatusBar(): void {
        if (!this.ready) return;
        if (this.useInk) {
            // For Ink, we'll update the status bar through our Ink interface
            return;
        }

        const rows = process.stdout.rows;
        const columns = process.stdout.columns;

        // Move to status row, clear line, write text
        process.stdout.write('\x1b[s'); // Save cursor position
        process.stdout.write(`\x1b[${rows};1H\x1b[K`);
        process.stdout.write(this.statusText.substring(0, columns));
        process.stdout.write('\x1b[u'); // Restore cursor position
    }

    setUserInput(text: string): void {
        this.userInput = text;
        this.render();
    }
    setSelector(list) {
        this.selector = list;
        this.render();
    }

    setStatus(text: string): void {
        this.statusText = text;
        if (this.useInk) {
            // setStatusBarText(text);
        } else {
            this.renderStatusBar();
        }
    }

    startAgent(): void {
        this.agentLines = 0;
    }

    print(text: string): void {
        if (!text.includes('\n')) {
            this.buffer[this.buffer.length - 1] += text;
        } else {
            let first = true;
            for (var line of text.split('\n')) {
                if (first) {
                    this.buffer[this.buffer.length - 1] += line;
                    first = false;
                } else {
                    this.buffer.push(line);
                    this.bufferOffset++;
                }
            }
        }
        this.render();
    }

    render() {
        process.stdout.write('\x1b[2J\x1b[H'); // Clear screen
        this.renderBuffer();
        this.renderStatusBar();
    }

    renderBuffer() {
        const buffer = this.buffer.concat(this.userInput.split('\n'), this.selector);

        const rows = process.stdout.rows;
        const columns = process.stdout.columns;
        var bufferLine = buffer.length;
        for (let i = rows - 2; i > 0; i--) {
            bufferLine--;
            if (buffer[bufferLine].length > columns) {
                i--;
            }
            process.stdout.write('\x1b[s'); // Save cursor position
            process.stdout.write(`\x1b[${i};1H\x1b[K`);
            process.stdout.write(`${buffer[bufferLine]}\n`);
            process.stdout.write('\x1b[u'); // Restore cursor position
            if (bufferLine === 0) break;
        }
    }

    getStatusBar(): StatusBar {
        return this.statusBar;
    }
}

export default Window;
