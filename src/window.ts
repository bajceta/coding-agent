import StatusBar from './statusBar.ts';
import { TerminalInputHandler } from './terminalInput.ts';
import type { Message } from './interfaces.ts';
import eventBus from './eventBus.ts';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';

class Window {
    columnPos: number = 0;
    statusText: string;
    statusBar: StatusBar;
    userLines: number;
    agentLines: number;
    inputHandler: TerminalInputHandler;
    ready: boolean;
    buffer: string[];
    bufferOffset: number;
    userInput: string;
    selector: string[];
    agentMessages: Message[];
    cursorColumn: number;
    prompt: string = 'User: ';
    showmore: boolean = false;

    constructor(agentMessages) {
        this.userLines = 0;
        this.agentLines = 0;
        this.statusText = '';
        this.statusBar = new StatusBar(this.setStatus.bind(this));
        this.ready = false;
        this.buffer = [''];
        this.bufferOffset = 0;
        this.userInput = '';
        this.selector = [];
        this.agentMessages = agentMessages;
        this.cursorColumn = 0;

        const nop = () => {};
        const setUserInput = this.setUserInput.bind(this);

        this.inputHandler = new TerminalInputHandler(nop, setUserInput, nop);
        this.inputHandler.setup();

        // Set up event handlers
        this.setupEventHandlers();

        // Set up terminal resize handler
        this.setupResizeHandler();
    }

    setReady(): void {
        this.ready = true;
    }

    // Render status bar (called internally)
    renderStatusBar(): void {
        if (!this.ready) return;

        const rows = process.stdout.rows;
        const columns = process.stdout.columns;
        const pureText = this.statusText.replace(/\x1b\[[0-9;]*m/g, '');
        const escapeCodeLength = this.statusText.length - pureText.length;

        process.stdout.write('\x1b[s'); // Save cursor position
        process.stdout.write(`\x1b[${rows};1H\x1b[K`);
        process.stdout.write(this.statusText.substring(0, columns + escapeCodeLength - 5));
        process.stdout.write('\x1b[u'); // Restore cursor position
    }

    setPrompt(text: string): void {
        this.prompt = text;
        this.render();
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
        this.renderStatusBar();
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
                }
            }
        }
        this.render();
    }

    renderMessages(): string {
        var msgs = '';
        for (let msg of this.agentMessages) {
            if (msg.role == 'assistant') {
                msgs += `${BLUE}${msg.role}: ${RESET}`;
                if (msg.reasoning_content.length > 0)
                    msgs += MAGENTA + msg.reasoning_content + RESET + '\n';
                if (msg.content.length > 0) msgs += msg.content + '\n';
                if (msg.tool_calls) {
                    for (let call of msg.tool_calls) {
                        const _args = this.showmore
                            ? call.function.arguments
                            : call.function.arguments.slice(0, 80) +
                              ' length:' +
                              msg.content.length;
                        const _lines = _args.split('\\n');
                        msgs +=
                            'toolcall ' +
                            call.function.name +
                            ' ' +
                            _lines.join('\n').replaceAll('\\"', '"').replaceAll('\\\\', '\\') +
                            '\n';
                    }
                }
            } else if (msg.role == 'user') {
                msgs += `${GREEN}${msg.role}: ${RESET}`;
                msgs += msg.content + '\n';
            } else if (msg.role == 'system') {
            } else if (msg.role == 'tool') {
                msgs += `${YELLOW}${msg.role}: ${RESET}`;
                if (this.showmore) msgs += msg.content + '\n';
                else msgs += msg.content.slice(0, 80) + ' length:' + msg.content.length + '\n';
            } else {
                msgs += JSON.stringify(msg) + '\n';
            }
        }
        return msgs;
    }

    content() {
        const userLines = this.userInput.split('\n');
        this.cursorColumn = userLines[userLines.length - 1]?.length + 1;
        const msgLines = this.renderMessages().split('\n');
        return this.buffer.concat(msgLines, this.prompt.split('\n'), userLines, this.selector);
    }

    render() {
        process.stdout.write('\x1b[2J\x1b[H'); // Clear screen
        const buffer = this.content();
        const rows = process.stdout.rows;
        const columns = process.stdout.columns;
        var bufferLine = Math.max(buffer.length - 1 - this.bufferOffset, 0);
        console.log(bufferLine);
        for (let i = rows - 2; i > 0; i--) {
            if (bufferLine < 0) break;
            const line = buffer[bufferLine];
            if (line) i = i - Math.trunc(buffer[bufferLine].length / columns);
            //process.stdout.write('\x1b[s'); // Save cursor position
            process.stdout.write(`\x1b[${i};1H\x1b[K`);
            process.stdout.write(`${buffer[bufferLine]}\n`);
            //process.stdout.write('\x1b[u'); // Restore cursor position
            //}
            bufferLine--;
        }
        const cursorRow = rows - 2 - this.selector.length;
        this.renderStatusBar();
        process.stdout.write(`\x1b[${cursorRow};${this.cursorColumn}H\x1b[K`);
    }

    getStatusBar(): StatusBar {
        return this.statusBar;
    }

    private setupEventHandlers(): void {
        eventBus.on('exit', () => {
            console.log('Exit event received in window.ts');
            for (let line of this.content()) {
                console.log(line);
            }
        });
        eventBus.on('scroll', (direction: 'up' | 'down') => {
            this.handleScroll(direction);
        });
        eventBus.on('print_buffer', () => {
            console.log(this.content());
        });
        eventBus.on('render', () => {
            this.render();
        });
        eventBus.on('selector', (list) => {
            this.setSelector(list);
        });
        eventBus.on('showmore', () => {
            this.showmore = !this.showmore;
            this.render();
        });
    }

    private handleScroll(direction: 'up' | 'down') {
        if (direction === 'down') {
            if (this.bufferOffset > 0) {
                this.bufferOffset--;
            }
        } else {
            if (this.content().length > this.bufferOffset) {
                this.bufferOffset++;
            }
        }

        this.render();
    }

    private setupResizeHandler(): void {
        const handleResize = () => {
            if (this.ready) {
                this.render();
            }
        };

        process.stdout.on('resize', handleResize);
    }
}

export default Window;
