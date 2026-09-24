#!/bin/bash

set -euo pipefail

HOME_DIR="$HOME"
CURRENT_DIR="$PWD"
SCRIPT_DIR=$(dirname "$(realpath "$0")")

# Safety: refuse to run in home directory
if [[ "$CURRENT_DIR" == "$HOME_DIR" ]]; then
    echo "Error: Cannot run in home directory. Please run from a subdirectory."
    exit 1
fi

# Confirmation (unless --yes-i-am-sure)
if [[ "$CURRENT_DIR" != "$HOME_DIR" && "$1" != "--yes-i-am-sure" ]]; then
    read -p "Are you sure you want to run the agent in YOLO mode in $CURRENT_DIR? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Operation cancelled."
        exit 0
    fi
fi

# Separate our flags from agent args
AGENT_args=()
if [[ "$1" == "--yes-i-am-sure" ]]; then
    echo "WARNING: YOLO MODE — no questions asked for tool calls"
    AGENT_args=("${@:2}")
else
    AGENT_args=("$@")
fi

# Isolation: unique container name from project path hash
PROJECT_HASH=$(echo -n "$CURRENT_DIR" | md5sum | cut -c1-8)
CONTAINER_NAME="agent-${PROJECT_HASH}"

# Per-container agent work dir (avoids shared-state conflicts)
AGENT_WORK_DIR="$HOME/agent_work/${PROJECT_HASH}"
mkdir -p "$AGENT_WORK_DIR"

# Optional DNS (only if the resolver is reachable)
DNS_ARGS=()
if ping -c1 -W1 192.168.3.254 &>/dev/null; then
    DNS_ARGS=(--dns 192.168.3.254)
fi

# Worktree support: if we're in a git worktree, mount the main repo at its
# absolute path so the .git pointer (gitdir: /path/to/main/.git/worktrees/...)
# resolves inside the container. Without this, git push/fetch fail.
EXTRA_MOUNTS=()
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null || true)
if [[ -n "$GIT_COMMON_DIR" ]]; then
    # Resolve to absolute path (it may be relative like ".git")
    GIT_COMMON_DIR=$(realpath "$GIT_COMMON_DIR")
    MAIN_REPO=$(dirname "$GIT_COMMON_DIR")
    # Only mount if the main repo is different from the current dir (i.e. we're
    # actually in a worktree, not the main checkout)
    if [[ "$MAIN_REPO" != "$CURRENT_DIR" ]]; then
        EXTRA_MOUNTS=(-v "$MAIN_REPO:$MAIN_REPO")
        echo "Main repo: $MAIN_REPO (mounted for git worktree access)"
    fi
fi

echo "Container: $CONTAINER_NAME"
echo "Workspace: $CURRENT_DIR"
echo "Agent work: $AGENT_WORK_DIR"
echo "Args: ${AGENT_args[*]:-none}"

docker run -it --rm \
    --name "$CONTAINER_NAME" \
    "${DNS_ARGS[@]}" \
    "${EXTRA_MOUNTS[@]}" \
    -v "$SCRIPT_DIR":/agent:ro \
    -v "$HOME/.config/codingagent.json":/home/node/.config/codingagent.json:ro \
    -v "$HOME/.ssh/id_ed_25519_aiagent":/home/node/.ssh/id_ed_25519_aiagent:ro \
    -v "$SCRIPT_DIR/.ssh/config":/home/node/.ssh/config:ro \
    --user $(id -u):$(id -g) \
    -v "$CURRENT_DIR":/workspace \
    -v "$AGENT_WORK_DIR":/workspace/.agent-work \
    -w /workspace \
    agent-runner:3 /agent/index.ts --yolo --disable-containers --no-intro "${AGENT_args[@]}"
