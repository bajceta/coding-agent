import fs from 'fs';
import path from 'path';

interface ModelConfig {
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
}

export interface Config {
    yoloMode: boolean;
    models: ModelConfig[];
    container: boolean; // Add container configuration
    parserType: string;
    safeTools: string[]; // Add safeTools array
}

const defaultConfig: Config = {
    models: [
        {
            name: 'default',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            model: 'gpt-4',
        },
    ],
    container: true,
    parserType: 'plain',
    yoloMode: false,
    safeTools: ['readFile'], // Add default safe tools
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
export const getDefaultModel = (): ModelConfig => config.models[0];
export const getConfig = (): Config => config;
