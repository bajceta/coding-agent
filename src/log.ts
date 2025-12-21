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
        // eslint-disable-next-line no-this-alias
        singleton = this;
    }

    private printMessage(level: string, message: string): void  {
        let coloredLevel = level;
        switch (level) {
            case 'trace':
                coloredLevel = '\x1b[36m' + level + '\x1b[0m'; // Cyan
                break;
            case 'debug':
                coloredLevel = '\x1b[32m' + level + '\x1b[0m'; // Green
                break;
            case 'info':
                coloredLevel = '\x1b[34m' + level + '\x1b[0m'; // Blue
                break;
            case 'error':
                coloredLevel = '\x1b[31m' + level + '\x1b[0m'; // Red
                break;
            default:
                coloredLevel = level;
        }
        this.print(`${coloredLevel} - ${this.moduleName || 'unknown'} - ${message}\n`);
    }

    trace(message: string): void {
        if (this.logLevel === 'trace') {
            this.printMessage(this.logLevel, message);
        }
    }

    debug(message: string): void {
        if (this.logLevel === 'debug' || this.logLevel === 'trace') {
             this.printMessage(this.logLevel, message);
        }
    }

    info(message: string): void {
        if (this.logLevel === 'info' || this.logLevel === 'debug' || this.logLevel === 'trace') {
          this.printMessage(this.logLevel, message);
        }
    }

    error(message: string): void {
        if (
            this.logLevel === 'error' ||
            this.logLevel === 'debug' ||
            this.logLevel === 'info' ||
            this.logLevel === 'trace'
        ) {
             this.printMessage(this.logLevel, message);
        }
    }


    static get(moduleName?: string): Log {
        if (!moduleName) {
            if (!singleton) {
                new Log(console.log.bind(console), getConfig().logLevel);
            }
            return singleton;
        }

        if (loggers.has(moduleName)) {
            return loggers.get(moduleName)!;
        }

        const newLogger = new Log(console.log.bind(console), getConfig().logLevel, moduleName);
        loggers.set(moduleName, newLogger);
        return newLogger;
    }
}

export default Log;
