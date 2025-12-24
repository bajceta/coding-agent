#!/bin/bash

# Check if running in home directory
HOME_DIR="$HOME"
CURRENT_DIR="$PWD"
SCRIPT_DIR=$(dirname "$(realpath "$0")")
echo "Script directory (relative): $SCRIPT_DIR"

# Check if current directory is exactly the home directory (not a subdirectory)
if [[ "$CURRENT_DIR" == "$HOME_DIR" ]]; then
    echo "Error: Cannot run in home directory. Please run from a subdirectory."
    exit 1
fi

# Ask for confirmation if not in home directory
if [[ "$CURRENT_DIR" != "$HOME_DIR" && "$1" != "--yes-i-am-sure" ]]; then
    read -p "Are you sure you want to run the agent in YOLO mode in $CURRENT_DIR? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Operation cancelled."
        exit 0
    fi
fi

REST=${@:1}
if [[ "$1" == "--yes-i-am-sure" ]]; then
    echo "WARNING WARNING WARNING YOLO MODE, NO QUESTIONS ASKED FOR TOOL CALLS"
    REST=${@:2}
fi

echo "using args:"
echo $REST
# Run the docker command
docker run -it --rm \
    -v $SCRIPT_DIR:/agent \
    -v $HOME/.config/codingagent.json:/home/node/.config/codingagent.json \
    --user $(id -u):$(id -g) \
    -v $PWD:/workspace \
    -v $HOME/agent_work:/workspace/agent \
    -w /workspace \
    agent-runner:1 /agent/index.ts --yolo --disable-containers --no-intro $REST
