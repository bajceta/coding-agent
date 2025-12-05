const { parseToolCalls, extractToolCallRaw } = require('../parser');

// Test cases for the tool call parser
describe('Tool Call Parser', () => {
  test('should extract tool call text correctly', () => {
    const responseText = 'Here is a tool call: {"tool_call": {"name": "readFile", "arguments": {"path": "/tmp/test.txt"}}}';
    const result = extractToolCallRaw(responseText);

    expect(result[0]).toEqual('{"name": "readFile", "arguments": {"path": "/tmp/test.txt"}}');
  });

  test('should parse single tool call correctly', () => {
    const responseText = 'Here is a tool call: {"tool_call": {"name": "readFile", "arguments": {"path": "/tmp/test.txt"}}}';
    const result = parseToolCalls(responseText);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'readFile',
      arguments: { path: '/tmp/test.txt' }
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
