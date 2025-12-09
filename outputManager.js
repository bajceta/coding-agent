class OutputManager {
    constructor() {
        this.window = null;
    }

    setWindow(window) {
        this.window = window;
    }

    print(chunk) {
        if (this.window) {
            this.window.print(chunk);
        } else {
            process.stdout.write(chunk);
        }
    }
}

module.exports = OutputManager;
