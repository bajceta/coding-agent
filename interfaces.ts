export interface Tool {
    name: string;
    description: string;
    arguments: Record<string, string>;
    execute: (...args: string[]) => Promise<any> | any;
}

export type Tools = Record<string, Tool>;

export interface ToolCall {
    name: string;
    arguments: Record<string, string>;
}
 
export interface ExecuteResult {
    success: boolean;
    content: string | null;
    error: string | null;
}
 
