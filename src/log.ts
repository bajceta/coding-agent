import { getConfig } from './config.ts';

let singleton;
const loggers: Map<string, Log> = new Map();

class Log {
    private logLevel: string;
    private print: (text) => void;
    private moduleName?: string;

    constructor(print: (text) => void, logLevel: string = 'info', moduleName?: string) {
        this.print = print;
        this.logLevel = logLevel;
        this.moduleName = moduleName;
        if (moduleName) {
            print(`Log level for module ${moduleName}: ${logLevel}\n`);
        } else {
            print('Log level: ' + logLevel + '\n');
        }
        // eslint-disable-next-line no-this-alias
        singleton = this;
    }

    trace(message: string): void {
        if (this.logLevel === 'trace') {
            const prefix = this.moduleName ? `[${this.moduleName}]` : '[DEBUG]';
            this.print(`\x1b[33m${prefix}\x1b[0m ${message}\n`);
        }
    }

    debug(message: string): void {
        if (this.logLevel === 'debug' || this.logLevel === 'trace') {
            const prefix = this.moduleName ? `[${this.moduleName}]` : '[DEBUG]';
            this.print(`\x1b[33m${prefix}\x1b[0m ${message}\n`);
        }
    }

    error(message: string): void {
        if (
            this.logLevel === 'error' ||
            this.logLevel === 'debug' ||
            this.logLevel === 'info' ||
            this.logLevel === 'trace'
        ) {
            const prefix = this.moduleName ? `[${this.moduleName}]` : '[ERROR]';
            this.print(`\x1b[31m${prefix}\x1b[0m ${message}\n`);
        }
    }

    info(message: string): void {
        if (this.logLevel === 'info' || this.logLevel === 'debug' || this.logLevel === 'trace') {
            const prefix = this.moduleName ? `[${this.moduleName}]` : '[INFO]';
            this.print(`\x1b[32m${prefix}\x1b[0m ${message}\n`);
        }
    }

    static get(moduleName?: string): Log {
        // If no module name is provided, return the singleton instance
        if (!moduleName) {
            if (!singleton) {
                new Log(console.log.bind(console), getConfig().logLevel);
            }
            return singleton;
        }

        // If module name is provided, check if we already have a logger for this module
        if (loggers.has(moduleName)) {
            return loggers.get(moduleName)!;
        }

        // Create a new logger for this module
        const newLogger = new Log(console.log.bind(console), getConfig().logLevel, moduleName);
        loggers.set(moduleName, newLogger);
        return newLogger;
    }
}

export default Log;
