const StatusBar = require('./statusBar');

class Window {
    constructor() {
        this.columnPos = 0;
        this.statusText = '';
        this.statusBar = new StatusBar();
    }

    // Set status text (called by OutputManager)
    setStatus(text) {
        this.statusText = text;
        this.renderStatusBar();
    }

    // Render status bar (called internally)
    renderStatusBar() {
        const rows = process.stdout.rows;
        const statusRow = rows;
        const columns = process.stdout.columns;

        // Move to status row, clear line, write text
        process.stdout.write(`\x1b[${statusRow};0H\x1b[K`);
        process.stdout.write(this.statusText);
        // Pad with spaces to ensure full row is cleared
        const padding = ' '.repeat(columns - this.statusText.length);
        process.stdout.write(padding);
    }

    // Update status bar with new data from StatusBar
    updateStatusBar() {
        const statusText = this.statusBar.getText();
        this.setStatus(statusText);
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