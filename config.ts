import fs from 'fs';
import path from 'path';

interface ModelConfig {
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
}

interface Config {
    models: ModelConfig[];
}

function getConfig(): Config {
    const configPath = path.join(process.env.HOME, '.config', 'codingagent.json');
    console.log(configPath);
    try {
        if (fs.existsSync(configPath)) {
            const configData = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(configData);
            return config;
        }
    } catch (error) {
        console.error('Error reading config file:', error.message);
    }

    // Return default configuration if file doesn't exist or has errors
    return {
        models: [
            {
                name: 'default',
                baseUrl: 'https://api.openai.com/v1',
                apiKey: '',
                model: 'gpt-“4',
            },
        ],
    };
}

function getDefaultModel(): ModelConfig {
    const config = getConfig();
    return (
        config.models[0]
    );
}

export { getConfig, getDefaultModel };
