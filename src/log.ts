import type { Config } from './config.ts';

class Log {
    private logLevel: string;
    private print: (text) => void;

    constructor(print: (text) => void, logLevel: string = 'info') {
        this.print = print;
        this.logLevel = logLevel;
    }

    trace(message: string): void {
        if (this.logLevel === 'trace') {
            this.print(`\x1b[33m[DEBUG]\x1b[0m ${message}`);
        }
    }

    debug(message: string): void {
        if (this.logLevel === 'debug' || this.logLevel === 'trace') {
            this.print(`\x1b[33m[DEBUG]\x1b[0m ${message}`);
        }
    }

    error(message: string): void {
        if (
            this.logLevel === 'error' ||
            this.logLevel === 'debug' ||
            this.logLevel === 'info' ||
            this.logLevel === 'trace'
        ) {
            this.print(`\x1b[31m[ERROR]\x1b[0m ${message}`);
        }
    }

    info(message: string): void {
        if (this.logLevel === 'info' || this.logLevel === 'debug' || this.logLevel === 'trace') {
            this.print(`\x1b[32m[INFO]\x1b[0m ${message}`);
        }
    }
}

export default Log;
