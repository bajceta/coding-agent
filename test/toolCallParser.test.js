const { parseToolCalls, extractToolCallRaw, setTools } = require('../parser');

const tools = {
    readFile: {
        name: 'readFile',
        description: 'Read the contents of a file',
        arguments: [
            { "path": "path to the file to read" },
        ],
    },
    writeFile: {
        name: 'writeFile',
        description: 'Read the contents of a file',
        arguments: [
            { "path": "path to the file to read" },
            { "content": "content of the file file to write" },
        ],
    },
};

        setTools(tools);
// Test cases for the tool call parser
describe('Tool Call Parser', () => {
    test.only('should extract single argument tool call text correctly', () => {
        const responseText = `
tool_call: readFile
path: /tmp/test.txt
end_tool_call
more text
`;
        const result = extractToolCallRaw(responseText);

        expect(result[0]).toEqual({"name": "readFile", "arguments":"path: /tmp/test.txt\n"});
    });

    test.only('should extract 2 argument tool call text correctly', () => {
        const responseText = `some text
tool_call: writeFile
path: /tmp/test.txt
content: hiho not so much
end_tool_call
more text
`;
        const result = extractToolCallRaw(responseText);
        expect(result[0]).toEqual({"name": "writeFile", "arguments":"path: /tmp/test.txt\ncontent: hiho not so much\n"});
    });
    test.only('should extract 2 argument long tool call text correctly', () => {
        const responseText = `
tool_call: writeFile
path: /tmp/test.txt
content: hiho
second line here
third here
end_tool_call
more text
`;
        const result = extractToolCallRaw(responseText);

        expect(result[0]).toEqual({"name": "writeFile", "arguments":"path: /tmp/test.txt\ncontent: hiho\nsecond line here\nthird here\n"});
    });
    test.only('should extract 2  separeate tool calls correctly', () => {
        const responseText = `some text
tool_call: writeFile
path: /tmp/test.txt
content: hiho not so much
end_tool_call
more text
tool_call: writeFile
path: /tmp/test.txt
content: hiho
second line here
third here
end_tool_call
more text
`;
        const result = extractToolCallRaw(responseText);
        expect(result[0]).toEqual({"name": "writeFile", "arguments":"path: /tmp/test.txt\ncontent: hiho not so much\n"});
        expect(result[1]).toEqual({"name": "writeFile", "arguments":"path: /tmp/test.txt\ncontent: hiho\nsecond line here\nthird here\n"});
    });

    test.only('should parse single tool call correctly', () => {
        const responseText = `[
tool_call: writeFile
path: /tmp/test.txt
content: hiho not so much
end_tool_call
more text
`
        const result = parseToolCalls(responseText);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            name: 'writeFile',
            arguments: [ '/tmp/test.txt', "hiho not so much"]
        });
    });

    test.only('should parse single argument single tool call correctly', () => {
        const responseText = `[
tool_call: readFile
path: /tmp/test.txt
end_tool_call
more text
`
        const result = parseToolCalls(responseText);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            name: 'readFile',
            arguments: [ '/tmp/test.txt']
        });
    });

    test.only('should parse long argument single tool call correctly', () => {
        const responseText = `[
tool_call: writeFile
path: /tmp/test.txt
content: hiho not so much
even longer
and longer
end_tool_call
more text
`
        const result = parseToolCalls(responseText);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            name: 'writeFile',
            arguments: [ '/tmp/test.txt', "hiho not so much\neven longer\nand longer"]
        });
    });
    test('should parse multiple tool calls correctly', () => {
        const responseText = 'First call: {"tool_call": {"name": "readFile", "arguments": {"path": "/tmp/test.txt"}}} Second call: {"tool_call": {"name": "writeFile", "arguments": {"path": "/tmp/output.txt", "content": "Hello"}}}';
        const result = parseToolCalls(responseText);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            name: 'readFile',
            arguments: { path: '/tmp/test.txt' }
        });
        expect(result[1]).toEqual({
            name: 'writeFile',
            arguments: { path: '/tmp/output.txt', content: 'Hello' }
        });
    });

    test('should handle malformed JSON gracefully', () => {
        const responseText = 'Some text {"tool_call": {"name": "readFile", "arguments": {"path": "/tmp/test.txt"}}} and more text with invalid json: {"tool_call": {"name": "writeFile", "arguments": }';
        const result = parseToolCalls(responseText);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            name: 'readFile',
            arguments: { path: '/tmp/test.txt' }
        });
    });

    test('should return empty array for no tool calls', () => {
        const responseText = 'Just regular text without any tool calls';
        const result = parseToolCalls(responseText);

        expect(result).toHaveLength(0);
    });

    test('should handle empty or invalid input', () => {
        expect(parseToolCalls(null)).toEqual([]);
        expect(parseToolCalls(undefined)).toEqual([]);
        expect(parseToolCalls('')).toEqual([]);
        expect(parseToolCalls(123)).toEqual([]);
    });
});
