import { getConfig } from './config.ts';

let singleton;
const loggers: Map<string, Log> = new Map();

// Mapping of log levels to numbers for easier comparison
const LOG_LEVELS = {
    trace: 0,
    debug: 1,
    info: 2,
    error: 3,
};

class Log {
    private logLevel: string;
    private logLevelNumber: number;
    private print: (text) => void;
    private moduleName?: string;

    constructor(print: (text) => void, logLevel: string = 'info', moduleName?: string) {
        this.print = print;
        this.logLevel = logLevel;
        this.logLevelNumber =
            LOG_LEVELS[logLevel] !== undefined ? LOG_LEVELS[logLevel] : LOG_LEVELS['info'];
        this.moduleName = moduleName;
        // eslint-disable-next-line no-this-alias
        singleton = this;
    }

    private printMessage(level: string, message: string): void {
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
        if (this.logLevelNumber <= LOG_LEVELS['trace']) {
            this.printMessage('trace', message);
        }
    }

    debug(message: string): void {
        if (this.logLevelNumber <= LOG_LEVELS['debug']) {
            this.printMessage('debug', message);
        }
    }

    info(message: string): void {
        if (this.logLevelNumber <= LOG_LEVELS['info']) {
            this.printMessage('info', message);
        }
    }

    error(message: string): void {
        if (this.logLevelNumber <= LOG_LEVELS['error']) {
            this.printMessage('error', message);
        }
    }

    static setLogLevel(logLevel): void {
        loggers.forEach((value, key, map) => {
            value.logLevel = logLevel;
            // Update the numeric log level as well
            value.logLevelNumber =
                LOG_LEVELS[logLevel] !== undefined ? LOG_LEVELS[logLevel] : LOG_LEVELS['info'];
        });
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
