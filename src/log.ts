import { getConfig } from './config.ts';

let singleton;
class Log {
    private logLevel: string;
    private print: (text) => void;

    constructor(print: (text) => void, logLevel: string = 'info') {
        this.print = print;
        this.logLevel = logLevel;
        print('Log level: ' + logLevel + '\n'); // @ts-ignore
        // eslint-disable-next-line no-this-alias
        singleton = this;
    }

    trace(message: string): void {
        if (this.logLevel === 'trace') {
            this.print(`\x1b[33m[DEBUG]\x1b[0m ${message}\n`);
        }
    }

    debug(message: string): void {
        if (this.logLevel === 'debug' || this.logLevel === 'trace') {
            this.print(`\x1b[33m[DEBUG]\x1b[0m ${message}\n`);
        }
    }

    error(message: string): void {
        if (
            this.logLevel === 'error' ||
            this.logLevel === 'debug' ||
            this.logLevel === 'info' ||
            this.logLevel === 'trace'
        ) {
            this.print(`\x1b[31m[ERROR]\x1b[0m ${message}\n`);
        }
    }

    info(message: string): void {
        if (this.logLevel === 'info' || this.logLevel === 'debug' || this.logLevel === 'trace') {
            this.print(`\x1b[32m[INFO]\x1b[0m ${message}\n`);
        }
    }
    static get(): Log {
        if (!singleton) {
            new Log(console.log.bind(console), getConfig().logLevel);
        }
        return singleton;
    }
}

export default Log;
