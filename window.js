class Window {
    constructor() {
        this.columnPos = 0;
    }

    newline() {
        const rows = process.stdout.rows;
        const statusRow = rows;  // Last row (status bar)
        const textAreaBottom = rows - 1; // Row above status bar
        //Clean status bar
        process.stdout.write(`\x1b[${statusRow};0H\x1b[K`);
        // Shift screen up to make room for new text
        process.stdout.write('\x1b[1S');
        // Move cursor to bottom of text area (above status bar)
        process.stdout.write(`\x1b[${textAreaBottom};0H`);
        this.columnPos = 0;
    }

    printAddToLine(chunk) {
        const columns = process.stdout.columns;
        if ((this.columnPos + chunk.length) > columns) {
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

}

module.exports = Window;