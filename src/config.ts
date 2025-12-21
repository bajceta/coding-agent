import fs from 'fs';
import path from 'path';

interface ModelConfig {
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
}

export interface Config {
    logLevel: string;
    yoloMode: boolean;
    models: ModelConfig[];
    container: boolean;
    parserType: string;
    safeTools: string[];
    logFile: string;
    useInk: boolean;
    rulesFile: string;
    modelName: string;
}

const defaultConfig: Config = {
    logLevel: 'info',
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
    logFile: '',
    useInk: false,
    rulesFile: '',
    modelName: 'default',
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
            config = defaultConfig;
        }
    } catch (error) {
        console.error('Error reading config file:', error.message);
        config = defaultConfig;
    }
}

export const getDefaultModel = (): ModelConfig => {
    const specifiedModel = config.models.find((m) => m.name === config.modelName);
    if (specifiedModel) {
        return specifiedModel;
    }
    return config.models[0];
};

export const getConfig = (): Config => config;
