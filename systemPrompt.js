
let addedTools = false;
function systemPrompt(messages, tools, toolPrompt) {
    let systemMsg;
    for (const msg of messages) {
        if (msg.role === 'system') {
            systemMsg = msg;
            break;
        }
    }
    if (!addedTools) {
        addedTools = true;
        if (Object.keys(tools).length > 0) {
            // Add system message that indicates available tools
            systemMsg.content = systemMsg.content + `
If you need information from files or system commands, use the appropriate tool.
${toolPrompt(tools)}
`
        } else {
            console.log("found no tool definitions");
        }
        //console.log(systemMsg)
    }
}


module.exports = { systemPrompt };
