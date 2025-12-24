import StatusBar from './statusBar.ts';
import MarkdownParser from './markdownParser.ts';
//import { addLog, setStatusBarText, initInkTerminal, setUserInput } from './ink-terminal.tsx';
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

    constructor(processInput: (text) => void, stopRequest, useInk: boolean = true, agent?: any) {
        this.columnPos = 0;
        this.userLines = 0;
        this.agentLines = 0;
        this.statusText = '';
        this.statusBar = new StatusBar(this.setStatus.bind(this));
        this.useInk = useInk;
        this.ready = false;
        const nop = () => {};
        if (useInk) {
            // For now, we'll comment out ink-related code since it's causing issues
            // initInkTerminal();
            // const printWholeBuffer = setUserInput;
            // this.inputHandler = new TerminalInputHandler(
            //     nop,
            //     printWholeBuffer,
            //     processInput,
            //     agent,
            // );
        } else {
            const printChunk = this.printUserInput.bind(this);
            const clearUserInput = this.clearUserInput.bind(this);
            this.inputHandler = new TerminalInputHandler(
                printChunk,
                nop,
                processInput,
                clearUserInput,
                stopRequest,
                agent,
            );
        }
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

    setStatus(text: string): void {
        this.statusText = text;
        if (this.useInk) {
            // setStatusBarText(text);
        } else {
            this.renderStatusBar();
        }
    }

    newline(): void {
        if (this.useInk) {
            // For Ink, we don't need to handle newlines manually
            return;
        }

        const rows = process.stdout.rows;
        const statusRow = rows;
        const textAreaBottom = rows - 1;

        // Clear status bar
        process.stdout.write(`\x1b[${statusRow};0H\x1b[K`);
        // Shift screen up
        process.stdout.write('\x1b[1S');
        // Move cursor to bottom of text area
        process.stdout.write(`\x1b[${textAreaBottom};0H`);
        this.columnPos = 0;
        this.renderStatusBar();
    }

    printAddToLine(chunk: string): void {
        if (this.useInk) {
            // For Ink, we just add to the log
            // addLog(chunk);
            return;
        }

        const columns = process.stdout.columns;
        if (this.columnPos + chunk.length > columns) {
            this.newline();
        }
        process.stdout.write(chunk);
        this.columnPos += chunk.length;
    }

    startAgent(): void {
        this.agentLines = 0;
    }

    clearAgentInput(): void {
        const rows = process.stdout.rows;
        const textAreaBottom = rows - 1;
        for (let i = 0; i < this.agentLines; i++) {
            process.stdout.write(`\x1b[1T;0H\x1b[K`);
        }
        process.stdout.write(`\x1b[${textAreaBottom};0H`);
        process.stdout.write('\x1b[K');
        this.agentLines = 0;
        this.renderStatusBar();
    }

    clearUserInput(): void {
        const rows = process.stdout.rows;
        const textAreaBottom = rows - 1;
        for (let i = 0; i < this.userLines; i++) {
            process.stdout.write(`\x1b[1T;0H\x1b[K`);
        }
        process.stdout.write(`\x1b[${textAreaBottom};0H`);
        process.stdout.write('\x1b[K');
        this.userLines = 0;
        this.print('\x1b[34mUser: \x1b[0m');
        this.renderStatusBar();
    }

    printUserInput(text: string): void {
        if (text.includes('\n')) {
            const lines = text.split('\n');
            this.printAddToLine(lines.shift() || '');
            for (const line of lines) {
                this.userLines++;
                this.newline();
                this.printAddToLine(line);
            }
        } else {
            this.printAddToLine(text);
        }
    }

    print(text: string): void {
        if (this.useInk) {
            // For Ink, we just add to the log
            // addLog(text);
            return;
        }

        // Parse markdown before printing
        //const formattedText = MarkdownParser.parse(text);
        // make json content prettier
        const formattedText = text; //.replaceAll("\\n", "\n");

        if (formattedText.includes('\n')) {
            const lines = formattedText.split('\n');
            this.printAddToLine(lines.shift() || '');
            for (const line of lines) {
                this.agentLines++;
                this.newline();
                this.printAddToLine(line);
            }
        } else {
            this.printAddToLine(formattedText);
        }
    }

    // Expose StatusBar for external updates
    getStatusBar(): StatusBar {
        return this.statusBar;
    }
}

export default Window;
