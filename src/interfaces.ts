export interface Tool {
    name: string;
    description: string;
    arguments: Record<string, string>[];
    execute: (...args: string[]) => Promise<any> | any;
    safe?: boolean;
}

export type Tools = Record<string, Tool>;

export interface ToolCall {
    id?: string;
    name: string;
    arguments: Record<string, string>;
}

export interface ExecuteResult {
    success: boolean;
    content: string | null;
    error: string | null;
}

export interface Message {
    role: string;
    content: string;
    tool_calls?: OpenaiRawToolCall[];
}

export interface LLMResponse {
    stats: any;
    msg: Message;
    reasoning?: string; // Make reasoning optional
}

export interface OpenaiToolDef {
    type: string;
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: Record<string, Record<string, string>>;
            required: string[];
        };
    };
}

export interface OpenaiRawToolCall {
    index: number;
    id: string;
    type: string;
    function: {
        name: string;
        arguments: string;
    };
}

export interface OpenaiToolCall {
    index: number;
    id: string;
    type: string;
    function: {
        name: string;
        arguments: Record<string, string>;
    };
}

export type OpenaiToolCalls = OpenaiToolCall[];
