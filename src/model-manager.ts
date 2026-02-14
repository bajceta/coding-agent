import LLM from './llm.ts';
import type { Config } from './config.ts';
import Log from './log.ts';
import eventBus from './eventBus.ts';

const log = Log.get('model-manager');

export interface ModelInfo {
    id: string;
    [key: string]: any;
}

export interface ModelsResponse {
    data?: ModelInfo[];
}

export class ModelManager {
    private llm: LLM;
    private config: Config;

    constructor(llm: LLM, config: Config) {
        this.llm = llm;
        this.config = config;
    }

    /**
     * Fetches and displays all available models
     */
    async listModels(): Promise<ModelInfo[]> {
        try {
            const modelsData = await this.llm.fetchModels();
            const models = modelsData.data || [];

            if (!Array.isArray(models)) {
                throw new Error('Invalid models response format');
            }

            return models;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log.error(`Error listing models: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Handles the list_models event to show all available models
     */
    async handleListModels(print: boolean): Promise<void> {
        try {
            const modelsData = await this.llm.fetchModels();
            const models = modelsData.data || [];

            if (!Array.isArray(models)) {
                throw new Error('Invalid models response format');
            }

            if (models.length === 0) {
                return;
            }
            const list = [];
            for (let index = 0; index < models.length; index++) {
                const m = models[index];
                const isSelected = m.id === this.config.modelName;
                const indicator = isSelected ? '✓ ' : '  ';
                const item = `${indicator}${index + 1}. ${m.id}`;
                log.info(item);
                list.push(item);
            }
            if (print) {
                console.log(list);
            } else {
                eventBus.emit('selector', list);
            }
        } catch {
            // Error already logged in listModels
        }
    }

    /**
     * Handles the select_model event to select a model by number
     * @returns true if model was successfully selected, false otherwise
     */
    async handleSelectModelByNumber(number: number): Promise<boolean> {
        try {
            const modelsData = await this.llm.fetchModels();
            const models = modelsData.data || [];

            if (!Array.isArray(models)) {
                throw new Error('Invalid models response format');
            }

            if (number < 1 || number > models.length) {
                return false;
            }

            const model = models[number - 1];

            // Update the config
            this.config.modelName = model.id;
            this.llm.updateModelConfig(model);

            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log.error(`Error selecting model: ${errorMessage}`);
            return false;
        }
    }

    /**
     * Gets the current model name
     */
    getCurrentModelName(): string {
        return this.llm.modelConfig.model;
    }

    /**
     * Gets the model configuration
     */
    getModelConfig(): { name: string; model: string } {
        return this.llm.modelConfig;
    }
}
