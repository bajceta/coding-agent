import { getConfig } from './config.ts';
import fs from 'fs';
import path from 'path';

let singleton;
const loggers: Map<string, Log> = new Map();
let logStream: fs.WriteStream | null = null;

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
        var msg;
        if (typeof message !== 'string') {
            msg = JSON.stringify(message);
        } else {
            msg = message;
        }
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
        this.print(`${coloredLevel} - ${this.moduleName || 'unknown'} - ${msg}\n`);
    }

    trace(message: any): void {
        if (this.logLevelNumber <= LOG_LEVELS['trace']) {
            this.printMessage('trace', message);
        }
    }

    debug(message: any): void {
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
        loggers.forEach((value, _key, _map) => {
            value.logLevel = logLevel;
            // Update the numeric log level as well
            value.logLevelNumber =
                LOG_LEVELS[logLevel] !== undefined ? LOG_LEVELS[logLevel] : LOG_LEVELS['info'];
        });
    }

    static setPrintMethod(print): void {
        loggers.forEach((value, _key, _map) => {
            value.print = print;
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

// Initialize file logging if logFile is configured
export function initFileLogging(logFile: string): void {
    if (!logFile) {
        return;
    }

    try {
        // Ensure the directory exists
        const logDir = path.dirname(logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        // Create write stream in append mode
        logStream = fs.createWriteStream(logFile, { flags: 'a' });

        // Handle stream errors
        logStream.on('error', (err) => {
            console.error(`Error writing to log file ${logFile}:`, err.message);
        });

        console.log(`📝 Log file initialized: ${logFile}`);
    } catch (error) {
        console.error(`Failed to initialize log file ${logFile}:`, error.message);
    }
}

// Write message to log file if stream is open
export function writeToFile(message: string): void {
    if (logStream) {
        try {
            // Strip ANSI color codes for file output
            const plainMessage = message.replace(/\x1b\[[0-9;]*m/g, '');
            logStream.write(plainMessage);
        } catch (error) {
            console.error('Error writing to log file:', error.message);
        }
    }
}

// Close the log file stream
export function closeLogFile(): void {
    if (logStream) {
        logStream.end();
        logStream = null;
        console.log('📝 Log file closed');
    }
}

// Create a print function that writes to both console and file
export function createPrintFunction(originalPrint: (text: string) => void): (text: string) => void {
    return (text: string) => {
        // Call the original print (console or window)
        originalPrint(text);
        // Also write to file if configured
        writeToFile(text);
    };
}

export default Log;
