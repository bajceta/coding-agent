const { parseToolCalls, extractToolCallRaw, extractArgs, setTools } = require('../parser');

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
    test.only('should extract tool call text correctly', () => {
        const responseText = `
tool_call: readFile
path:/tmp/test.txtENDARG
end_tool_call
more text
`;
        const result = extractToolCallRaw(responseText);

        expect(result[0]).toEqual({"name": "readFile", "arguments":"path:/tmp/test.txtENDARG\n"});
    });

    test.only('should extract single argument tool call text correctly', () => {
        const responseText = `path:/tmp/test.txtENDARG`;
        const result = extractArgs(responseText);

        expect(result[0]).toEqual({"name": "path", "value":"/tmp/test.txt"});
    });

    test.only('should extract 2 argument tool call text correctly', () => {
        const responseText = `path:/tmp/test.txtENDARG
content:hiho not so muchENDARG
`;
        const result = extractArgs(responseText);
        expect(result[0]).toEqual({"name": "path", "value":"/tmp/test.txt"});
        expect(result[1]).toEqual({"name": "content", "value":"hiho not so much"});
    });

    test.only('should extract multiline argument tool call text correctly', () => {
        const responseText = `path:/tmp/test.txtENDARG
content:hiho
not
so muchENDARG
val2:testingENDARG
`;
        const result = extractArgs(responseText);
        expect(result[0]).toEqual({"name": "path", "value":"/tmp/test.txt"});
        expect(result[1]).toEqual({"name": "content", "value":"hiho\nnot\nso much"});
        expect(result[2]).toEqual({"name": "val2", "value":"testing"});
    });



    test('should extract 2 argument long tool call text correctly', () => {
        const responseText = `
tool_call: writeFile
path:/tmp/test.txt
content:hiho
second line here
third here
end_tool_call
more text
`;
        const result = extractToolCallRaw(responseText);

        expect(result[0]).toEqual({"name": "writeFile", "arguments":"path:/tmp/test.txt\ncontent:hiho\nsecond line here\nthird here\n"});
    });
    test('should extract 2  separeate tool calls correctly', () => {
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
        const result = extractToolCallRaw(responseText);
        expect(result[0]).toEqual({"name": "writeFile", "arguments":"path:/tmp/test.txt\ncontent:hiho not so much\n"});
        expect(result[1]).toEqual({"name": "writeFile", "arguments":"path:/tmp/test.txt\ncontent:hiho\nsecond line here\nthird here\n"});
    });

    test('should parse single tool call correctly', () => {
        const responseText = `[
tool_call: writeFile
path:/tmp/test.txt
content:hiho not so much
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

    test('should parse single argument single tool call correctly', () => {
        const responseText = `[
tool_call: readFile
path:/tmp/test.txt
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

    test('should parse long argument single tool call correctly', () => {
        const responseText = `[
tool_call: writeFile
path:/tmp/test.txt
content:hiho not so much
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

    test('should parse a long write file single tool call correctly', () => {
       const fs = require('fs');
       const responseText =  fs.readFileSync('./test/longWriteFile.txt', 'utf8');
        const result = parseToolCalls(responseText);

        expect(result).toHaveLength(1);
        expect(result[0].name).toEqual("writeFile");
        expect(result[0].arguments[0]).toEqual("index2.js");
        expect(result[0].arguments[1]).toMatch(/main\(\).catch\(console.error\);$/);
        expect(result[0].arguments[1]).toMatch(/#!\/usr/);
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
