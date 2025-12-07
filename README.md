# Coding Agent

An implementation of a coding agent that has dynamic tool discovery.

In /tools folder we will add tools as needed.
Subfolder to group tools.

It should use openai compatible endpoint. Read settings from ~/.config/codingagent.json file.

Tool calling works with Qwen3, it's naive, but uses few tokens.

# Usage

Interactive
```
node index.js
```

Cli
```
node index.js "Read agent.js and do a code review. Store results into codereview.md"
```

Make it available via alias

```
echo "alias agent=$PWD/index.js" >> ~/.bashrc
echo "alias agent=$PWD/index.js" >> ~/.zshrc
```
