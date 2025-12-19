import fs from 'fs';
import path from 'path';

interface ModelConfig {
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
}

export interface Config {
    logLevel: string; // Add logLevel property to Config interface
    yoloMode: boolean;
    models: ModelConfig[];
    container: boolean;
    parserType: string;
    safeTools: string[];
    logFile: string; // Add logFile property to Config interface
    useInk: boolean; // Add Ink support
    rulesFile: string; // Add rules file property
}

const defaultConfig: Config = {
    logLevel: 'info', // Add default value for logLevel
    models: [
        {
            name: 'default',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            model: 'gpt-4',
        },
    ],
    container: true,
    parserType: 'native',
    yoloMode: false,
    safeTools: ['readFile'],
    logFile: '', // Add default value for logFile
    useInk: false, // Add default value for useInk
    rulesFile: '', // Add default value for rulesFile
};

let config: Config = null;

export function init(): void {
    const configPath = path.join(process.env.HOME, '.config', 'codingagent.json');
    try {
        if (fs.existsSync(configPath)) {
            const configData = fs.readFileSync(configPath, 'utf8');
            config = {
                ...defaultConfig,
                ...JSON.parse(configData),
            };
        } else {
            // Create default configuration
            config = defaultConfig;
        }
    } catch (error) {
        console.error('Error reading config file:', error.message);
        config = defaultConfig;
    }
}

// Export the singleton instance

export const getDefaultModel = (): ModelConfig => {
    // Find the model with name property matching the provided modelName
    const specifiedModel = config.models.find((m) => m.name === config.modelName);
    if (specifiedModel) {
        return specifiedModel;
    }
    // Fallback to the first model in the array
    return config.models[0];
};

export const getConfig = (): Config => config;
