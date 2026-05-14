import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { JSONParser } from '../src/parser-json.ts';

const tools = {
    readFile: {
        name: 'readFile',
        description: 'Read the contents of a file',
        arguments: [{ path: 'path to the file to read' }],
    },
    writeFile: {
        name: 'writeFile',
        description: 'Read the contents of a file',
        arguments: [
            { path: 'path to the file to read' },
            { content: 'content of the file file to write' },
        ],
    },
};

const parser = new JSONParser();

// Test cases for the tool call parser
describe('Tool Call Parser JSON', () => {
    it('should extract single tool call', () => {
        const responseText = `
d file readme.md

Agent:
{
  "tool_call": {
    "name": "readFile",
    "arguments": {
      "path": "/tmp/test.txt"
    }
  }
}
something more
`;
        const result = parser.parseToolCalls({ content: responseText }, tools as any);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ name: 'readFile', arguments: { path: '/tmp/test.txt' } });
    });

    it('should extract 2 tool calls', () => {
        const responseText = `
d file readme.md

Agent:
{
  "tool_call": {
    "name": "readFile",
    "arguments": {
      "path": "/tmp/test.txt"
    }
  }
}
something more
{
  "tool_call": {
    "name": "writeFile",
    "arguments": {
      "path": "/tmp/test.txt",
      "content": "This is the file content\\nmultiline\\n"
    }
  }
}
`;
        const result = parser.parseToolCalls({ content: responseText }, tools as any);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ name: 'readFile', arguments: { path: '/tmp/test.txt' } });
        expect(result[1]).toEqual({
            name: 'writeFile',
            arguments: {
                path: '/tmp/test.txt',
                content: 'This is the file content\nmultiline\n',
            },
        });
    });

    it('should extract with quotes tool calls', () => {
        const responseText = readFileSync('./test/smalljson.txt', 'utf8');
        const result = parser.parseToolCalls({ content: responseText }, tools as any);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            name: 'writeFile',
            arguments: {
                path: '/tmp/test.txt',
                content: 'This is with  "',
            },
        });
    });

    it('should extract when there is js code inside tool calls', () => {
        const responseText = readFileSync('./test/longJsonFile.txt', 'utf8');
        const result = parser.parseToolCalls({ content: responseText }, tools as any);

        expect(result[0].name).toEqual('writeFile');
        expect(result[0].arguments.path).toEqual('agent2.js');
        expect(result[0].arguments.content).toMatch(/module.exports = Agent;$/);
        expect(result[0].arguments.content).toMatch(/const LLM/);
    });
});
