import type Agent from './agent.ts';

export class TerminalInputHandler {
    private agent: Agent;
    private buffer: string = '';
    private stdin: NodeJS.ReadStream;

    constructor(agent: Agent) {
        this.agent = agent;
        this.stdin = process.stdin;
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

            if (code === 13) {
                // ENTER key (CR)
                this.agent.processInput(this.buffer);
                this.buffer = '';
                return;
            }
            if (code === 0x7f || code === 0x08) { // Backspace (DEL or BS)
                if (this.buffer.length > 0) {
                    this.buffer = this.buffer.slice(0, -1); // Remove last character
                    process.stdout.write('\x08 \x08'); // Move cursor back, clear, move back
                }
                return;
            }
            if (code === 0x03) { // Ctrl+C
                console.log('\nExiting...');
                process.exit(0);
            }

            if (code === 10 && chunk === '\n') {
                // Raw mode still emits LF sometimes, but Enter is CR above (13)
                // So treat plain LF only as typed text
                this.buffer += '\n';
                this.agent.print('\n');
                return;
            }

            if (code === 10 && this.stdin.isRaw) {
                // Ctrl+J generates LF (10)
                this.buffer += '\n';
                this.agent.print('\n');
                return;
            }

            // Normal characters
            this.buffer += chunk;
            this.agent.print(chunk);
        });

        this.stdin.on('end', () => {
            this.agent.print('\nInput ended');
            console.log('\nInput ended');
        });
    }
}
