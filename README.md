# Coding Agent

An implementation of a coding agent that has dynamic tool discovery.

In /tools folder we will add tools as needed.
Subfolder to group tools.

It should use openai compatible endpoint. Read settings from ~/.config/codingagent.json file.

Tool calling works with Qwen3, it's naive, but uses few tokens.

# Usage

## Interactive Mode

```
node index.js
```

## Command Line Interface

```
node index.js "Read agent.js and do a code review. Store results into codereview.md"
```

## Setting up an Alias

To make the agent easily accessible, add this to your shell configuration file:

For bash:

```
echo "alias agent=$PWD/index.ts" >> ~/.bashrc
```

For zsh:

```
echo "alias agent=\"/home/vlada/.local/share/fnm/node-versions/v24.11.1/installation/bin/node $PWD/index.ts --enable-containers\"" >> ~/.zshrc
echo "alias yolo=\"$PWD/start-docker.sh --yes-i-am-sure\"" >> ~/.zshrc
```
