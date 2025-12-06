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

