const StatusBar = require('./statusBar');

class Window {
    constructor() {
        this.columnPos = 0;
        this.statusText = '';
        this.statusBar = new StatusBar(this.setStatus.bind(this));
    }

    // Render status bar (called internally)
    renderStatusBar() {
        const rows = process.stdout.rows;

        // Move to status row, clear line, write text
        process.stdout.write('\x1b[s'); // Save cursor position
        process.stdout.write(`\x1b[${rows};1H\x1b[K`);
        process.stdout.write(this.statusText);
        //process.stdout.write(`Tokens/s: ${this.lastTokensPerSecond.toFixed(2)}`);
        process.stdout.write('\x1b[u'); // Restore cursor position
    }
    setStatus(text) {
        this.statusText = text;
        this.renderStatusBar();
    }

    newline() {
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

    printAddToLine(chunk) {
        const columns = process.stdout.columns;
        if (this.columnPos + chunk.length > columns) {
            this.newline();
        }
        process.stdout.write(chunk);
        this.columnPos += chunk.length;
    }

    print(text) {
        if (text.includes('\n')) {
            const lines = text.split('\n');
            this.printAddToLine(lines.shift());
            for (const line of lines) {
                this.newline();
                this.printAddToLine(line);
            }
        } else {
            this.printAddToLine(text);
        }
    }

    // Expose StatusBar for external updates
    getStatusBar() {
        return this.statusBar;
    }
}

module.exports = Window;
