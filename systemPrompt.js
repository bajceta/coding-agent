function systemPrompt(messages, tools) {
    let hasToolDefinitions = false;
    let systemMsg;
    for (const msg of messages) {
        if (msg.role === 'system') {
            systemMsg = msg;
            if (systemMsg.content.includes('tools') || systemMsg.content.includes('functions')) {
                hasToolDefinitions = true;
            }
            break;
        }
    }
    if (!hasToolDefinitions) {
        const toolDefinitions = getToolDefinitions(tools);

        if (toolDefinitions.length > 0) {
            // Add system message that indicates available tools
            systemMsg.content = systemMsg.content + `
If you need information from files or system commands, use the appropriate tool.
When you need to use tools, respond using this format:
tool_call: toolName
argument1:value
argument2:longer
value
end_tool_call

IMPORTANT Tool calling argument rules:
 - names are followed by a column
 - never place values in quotes
 - format of arguments is strictly name:value, no space after the name:

Example: list files in current folder with ls.
tool_call: runCommand
command:ls
end_tool_call
Example: find text "treasure" in current folder
tool_call: findText
path:./
text:treasure
Example: write content to file 'demo.js'
tool_call:writeFile
path:demo.js
content:function helloWorld(){
   console.log("hello world");
}
helloWorld();
end_tool_call

You have access to following tools:
${toolDefinitions.map(toolDefinitionToText).join('\n')}
            `
        } else {
            console.log("found no tool definitions");
        }
        console.log(systemMsg)
    }
}

function getToolDefinitions(tools) {
    const definitions = [];
    for (const [name, tool] of Object.entries(tools)) {
        if (tool.arguments && tool.description) {
            definitions.push({
                name: tool.name || name,
                description: tool.description,
                arguments: tool.arguments
            });
        }
    }
    return definitions;
}

function toolDefinitionToText(def) {
    const args = [];

    def.arguments.forEach(arg => {
        const entries = Object.entries(arg);
        args.push(entries[0][0] + ":" + entries[0][1]);
    });
    const result = `
tool_name: ${def.name}
description: ${def.description}
arguments:
${args.join('\n')}
`
    return result;
}

module.exports = { systemPrompt };
