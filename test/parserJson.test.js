const fs = require('fs');
const { parseToolCalls, extractToolCallRaw, setTools } = require('../parser-json');

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

setTools(tools);
// Test cases for the tool call parser
describe('Tool Call Parser JSON', () => {
    test('should extract single tool call', () => {
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
        const result = extractToolCallRaw(responseText);

        expect(result[0]).toEqual({ name: 'readFile', arguments: { path: '/tmp/test.txt' } });

        const toolCalls = parseToolCalls(responseText);
        console.log(toolCalls);
    });

    test('should extract 2 tool calls', () => {
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
        const result = extractToolCallRaw(responseText);

        expect(result[0]).toEqual({ name: 'readFile', arguments: { path: '/tmp/test.txt' } });
        expect(result[1]).toEqual({
            name: 'writeFile',
            arguments: {
                path: '/tmp/test.txt',
                content: 'This is the file content\nmultiline\n',
            },
        });
    });

    test('should extract with quotes tool calls', () => {
        const responseText = fs.readFileSync('./test/smalljson.txt', 'utf8');
        const result = extractToolCallRaw(responseText);

        expect(result[0]).toEqual({
            name: 'writeFile',
            arguments: {
                path: '/tmp/test.txt',
                content: 'This is with  "',
            },
        });
    });

    test('should extract when there is js code inside tool calls', () => {
        const fs = require('fs');
        const responseText = fs.readFileSync('./test/longJsonFile.txt', 'utf8');
        const result = extractToolCallRaw(responseText);

        expect(result[0].name).toEqual('writeFile');
        expect(result[0].arguments.path).toEqual('agent2.js');
        expect(result[0].arguments.path).toEqual('agent2.js');

        expect(result[0].arguments.content).toMatch(/module.exports = Agent;$/);
        expect(result[0].arguments.content).toMatch(/const LLM/);
    });
});
