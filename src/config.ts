import fs from 'fs';
import path from 'path';

interface ModelConfig {
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
}

interface MCPServerConfig {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
}

export type ExecutionMode = 'read' | 'write' | 'run';

export interface Config {
    tools: any;
    logLevel: string;
    executionMode: ExecutionMode;
    models: ModelConfig[];
    container: boolean;
    parserType: string;
    logFile: string;
    rulesFile: string;
    modelName: string;
    stream: boolean;
    mcpServers: MCPServerConfig[];
    saveFile: string;
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
    container: false,
    parserType: 'native',
    executionMode: 'read',
    logFile: '',
    rulesFile: '',
    modelName: 'default',
    stream: true,
    tools: true,
    saveFile: '',
    mcpServers: [
        {
            name: 'browsermcp',
            command: 'npx',
            args: ['-y', '@browsermcp/mcp@latest'],
        },
    ],
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

export const getConfig = (): Config => {
    if (!config) {
        init();
    }
    return config;
};

export const getMCPServers = (): MCPServerConfig[] => {
    if (!config) {
        init();
    }
    return config.mcpServers || [];
};

export type { MCPServerConfig };
