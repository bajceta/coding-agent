#!/bin/bash

# Check if running in home directory
HOME_DIR="$HOME"
CURRENT_DIR="$PWD"

# Check if current directory is exactly the home directory (not a subdirectory)
if [[ "$CURRENT_DIR" == "$HOME_DIR" ]]; then
    echo "Error: Cannot run in home directory. Please run from a subdirectory."
    exit 1
fi

# Ask for confirmation if not in home directory
if [[ "$CURRENT_DIR" != "$HOME_DIR" ]]; then
    read -p "Are you sure you want to run the agent in YOLO mode in $CURRENT_DIR? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Operation cancelled."
        exit 0
    fi
fi

# Run the docker command
docker run -it --rm \
    -v $HOME/src/innercore/agent2:/agent \
    -v $HOME/.config/codingagent.json:/home/node/.config/codingagent.json \
    --user $(id -u):$(id -g) \
    -v $PWD:/workspace \
    -w /workspace \
    agent-runner:1 /agent/index.ts --yolo $1
