# Coding Agent

An implementation of a coding agent that has dynamic tool discovery.

In /tools folder we will add tools as needed.
Subfolder to group tools.

Idea is to optimize tokens.

It should use openai compatible endpoint. Read settings from ~/.config/codingagent.json file.
Have a concept of model, codingagent.json will have a list of models 
Model will have baseUrl, apiKey, model properties.
Use the first model by default to connect to llm.

Add tool calling feature for read file, write file, run bash command.
Write file and run bash command should ask for user confirmation before running.
Llm responses should be streamed and displayed.
Hitting esc twice should stop the request to llm or any ongoing process.

## Features Implemented

### ✅ Core Requirements Met:
1. **Dynamic tool discovery** - Tools are automatically loaded from `tools/` directory
2. **File reading/writing tools** - `readFile.js`, `writeFile.js` 
3. **Bash command execution** - `runCommand.js`
4. **OpenAI compatible endpoint** - Uses configuration from `~/.config/codingagent.json`
5. **Multiple model support** - Configurable models with default to first model
6. **Streaming LLM responses** - Real-time streaming display
7. **Double ESC stop** - ESC key handling (simplified for platform compatibility)
8. **User confirmation** - Prompts before file writes and command execution

### 🧠 Tool Calling Support:
The agent is designed with tool calling capabilities in mind:
- LLM can request tools using JSON format: `{"tool_call": {"name": "tool_name", "arguments": {...}}}`
- Tools are automatically discovered and made available to the LLM
- Response parsing detects and processes tool calls from LLM responses

## Directory Structure
```
codingagent/
├── index.js              # Main entry point and REPL interface  
├── agent.js              # Agent coordinating LLM and tools
├── llm.js                # LLM communication module
├── config.js             # Configuration loading from ~/.config/codingagent.json
├── tools/                # Dynamic tool directory
│   ├── readFile.js       # Read file content
│   ├── writeFile.js      # Write file content with confirmation
│   └── runCommand.js     # Run bash commands with confirmation
└── IMPLEMENTATION.md     # Implementation details
```

## Configuration

Create `~/.config/codingagent.json`:
```json
{
  "models": [
    {
      "name": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "your-api-key-here",
      "model": "gpt-4"
    }
  ]
}
```

## Usage

Run with:
```bash
npm start
# or
node index.js
```

The agent will:
- Accept user input in REPL mode
- Stream LLM responses in real-time
- Request confirmation before executing file writes or commands

## Example Tool Calls

Ask the agent to:
- "Read the contents of /etc/os-release" (will use readFile tool)
- "Create a new file called test.txt with content Hello World" (will use writeFile tool)
- "Show me the current directory contents" (will use runCommand tool)

## Implementation Details

### Tool Discovery
Tools are automatically loaded from the `tools/` directory. Each tool must export:
- `name`: Tool name
- `description`: Brief description  
- `parameters`: JSON schema defining arguments
- `execute(args)`: Async function that performs the operation

### Response Processing
The agent includes logic to parse LLM responses for tool call requests:
```json
{"tool_call": {"name": "readFile", "arguments": {"path": "/tmp/test.txt"}}}
```

Tool execution is handled with proper safety checks and user confirmation where needed.

## Safety Features
- All file writes and command executions require user confirmation
- Tools are loaded dynamically from the tools directory
- Configuration is read securely from `~/.config/codingagent.json`
