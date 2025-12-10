import type { Tool, ToolCall, Tools } from './interfaces.ts';

// Parser interface for tool call parsing
export interface Parser {
    parseToolCalls(content: string): ToolCall[];
    toolPrompt(tools: Tools): string;
    setTools(tools: Tools): void;
}

// Utility type for tool call extraction
export type ExtractedToolCall = {
    name: string;
    arguments: string;
};

// Utility type for extracted arguments
export type ExtractedArgument = {
    name: string;
    value: string;
};

// Utility type for tool call format
export type ToolCallFormat = {
    name: string;
    arguments: Record<string, any>;
};
