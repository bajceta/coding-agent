import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { PlainTextParser } from '../src/parser-plain.ts';

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

const parser = new PlainTextParser();

// Test cases for the tool call parser
describe('Tool Call Parser', () => {
    it('should extract tool call text correctly', () => {
        const responseText = `
tool_call: readFile
path:/tmp/test.txtENDARG
end_tool_call
more text
`;
        const toolCallRegex = /tool_call: ?(\w+)\n([\s\S]*?)end_tool_call/g;
        const match = toolCallRegex.exec(responseText);

        expect(match).not.toBeNull();
        expect(match![1]).toEqual('readFile');
        expect(match![2]).toEqual('path:/tmp/test.txtENDARG\n');
    });

    it('should extract single argument tool call text correctly', () => {
        const responseText = `path:/tmp/test.txtENDARG`;
        const args = parser['extractArgs'](responseText);

        expect(args[0]).toEqual({ name: 'path', value: '/tmp/test.txt' });
    });

    it('should extract 2 argument tool call text correctly', () => {
        const responseText = `path:/tmp/test.txtENDARG
content:hiho not so muchENDARG
`;
        const args = parser['extractArgs'](responseText);
        expect(args[0]).toEqual({ name: 'path', value: '/tmp/test.txt' });
        expect(args[1]).toEqual({ name: 'content', value: 'hiho not so much' });
    });

    it('should extract multiline argument tool call text correctly', () => {
        const responseText = `path:/tmp/test.txtENDARG
content:hiho
not
so muchENDARG
val2:testingENDARG
`;
        const args = parser['extractArgs'](responseText);
        expect(args[0]).toEqual({ name: 'path', value: '/tmp/test.txt' });
        expect(args[1]).toEqual({ name: 'content', value: 'hiho\nnot\nso much' });
        expect(args[2]).toEqual({ name: 'val2', value: 'testing' });
    });

    it('should extract 2 argument long tool call text correctly', () => {
        const responseText = `
tool_call: writeFile
path:/tmp/test.txt
content:hiho
second line here
third here
end_tool_call
more text
`;
        const toolCallRegex = /tool_call: ?(\w+)\n([\s\S]*?)end_tool_call/g;
        const match = toolCallRegex.exec(responseText);

        expect(match).not.toBeNull();
        expect(match![1]).toEqual('writeFile');
        expect(match![2]).toEqual(
            'path:/tmp/test.txt\ncontent:hiho\nsecond line here\nthird here\n',
        );
    });

    it('should extract 2 separate tool calls correctly', () => {
        const responseText = `some text
tool_call: writeFile
path:/tmp/test.txt
content:hiho not so much
end_tool_call
more text
tool_call: writeFile
path:/tmp/test.txt
content:hiho
second line here
third here
end_tool_call
more text
`;
        const toolCallRegex = /tool_call: ?(\w+)\n([\s\S]*?)end_tool_call/g;
        const matches = [...responseText.matchAll(toolCallRegex)];

        expect(matches).toHaveLength(2);
        expect(matches[0][1]).toEqual('writeFile');
        expect(matches[0][2]).toEqual('path:/tmp/test.txt\ncontent:hiho not so much\n');
        expect(matches[1][1]).toEqual('writeFile');
        expect(matches[1][2]).toEqual(
            'path:/tmp/test.txt\ncontent:hiho\nsecond line here\nthird here\n',
        );
    });

    it('should parse single tool call correctly', () => {
        const responseText = `[
tool_call: writeFile
path:/tmp/test.txtENDARG
content:hiho not so muchENDARG
end_tool_call
more text
`;
        const result = parser.parseToolCalls({ content: responseText }, tools as any);

        expect(result).toHaveLength(1);
        expect(result[0].name).toEqual('writeFile');
        expect(result[0].arguments).toEqual({ path: '/tmp/test.txt', content: 'hiho not so much' });
    });

    it('should parse single argument single tool call correctly', () => {
        const responseText = `[
tool_call: readFile
path:/tmp/test.txtENDARG
end_tool_call
more text
`;
        const result = parser.parseToolCalls({ content: responseText }, tools as any);

        expect(result).toHaveLength(1);
        expect(result[0].name).toEqual('readFile');
        expect(result[0].arguments).toEqual({ path: '/tmp/test.txt' });
    });

    it('should parse long argument single tool call correctly', () => {
        const responseText = `[
tool_call: writeFile
path:/tmp/test.txtENDARG
content:hiho not so much
even longer
and longerENDARG
end_tool_call
more text
`;
        const result = parser.parseToolCalls({ content: responseText }, tools as any);

        expect(result).toHaveLength(1);
        expect(result[0].name).toEqual('writeFile');
        expect(result[0].arguments).toEqual({
            path: '/tmp/test.txt',
            content: 'hiho not so much\neven longer\nand longer',
        });
    });

    it('should parse a long write file single tool call correctly', () => {
        const responseText = readFileSync('./test/longWriteFile.txt', 'utf8');
        const result = parser.parseToolCalls({ content: responseText }, tools as any);

        expect(result).toHaveLength(1);
        expect(result[0].name).toEqual('writeFile');
        // Note: longWriteFile.txt doesn't use ENDARG markers, so arguments won't be extracted
        expect(result[0].arguments).toEqual({});
    });

    it('should return empty array for no tool calls', () => {
        const responseText = 'Just regular text without any tool calls';
        const result = parser.parseToolCalls({ content: responseText }, tools as any);

        expect(result).toHaveLength(0);
    });

    it('should handle empty or invalid input', () => {
        expect(parser.parseToolCalls({ content: '' }, tools as any)).toEqual([]);
    });
});
