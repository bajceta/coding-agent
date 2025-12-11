import type { ToolCall, Tools, Message } from './interfaces.ts';

// Parser interface for tool call parsing
export interface Parser {
    parseToolCalls(response: Message, tools: Tools): ToolCall[];
    toolPrompt(tools: Tools): string;
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
