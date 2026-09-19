# Runner — Running the Coding Agent in Docker

## Problem

We want to run the AI coding agent (`index.ts`) inside Docker containers such that:

1. The agent can run full test suites (`npm test`, `npx vitest run`, etc.) in the project folder.
2. Long-running processes (servers, watchers, build pipelines) can be managed inside the container.
3. Multiple containers running simultaneously (on different projects) **do not interfere** with each other.

## Current State

### Dockerfile (`agent-runner:2`)

```dockerfile
FROM node:24-alpine3.23
RUN apk add --no-cache ripgrep the_silver_searcher git bash grep curl findutils
RUN npm install -g @vtsls/language-server oxfmt oxlint typescript
RUN apk add --no-cache python3 patch
RUN apk add --no-cache php
COPY build.sh ./
RUN ./build.sh
```

**Missing:** `tmux`, `make`, `cmake`, `jq`, `tree`, `htop`, `unzip`, `wget`, `sqlite3`, `openssl`, `procps` (for `ps`/`kill`).

### `start-docker.sh` (symlinked as `~/bin/yolo`)

```bash
docker run -it --rm \
    -v $SCRIPT_DIR:/agent \
    --dns 192.168.3.254 \
    -v $HOME/.config/codingagent.json:/home/node/.config/codingagent.json \
    --user $(id -u):$(id -g) \
    -v $PWD:/workspace \
    -v $HOME/agent_work:/workspace/agent \
    -w /workspace \
    agent-runner:2 /agent/index.ts --yolo --disable-containers --no-intro "${AGENT_args[@]}"
```

**How it works:**

- Mounts the agent source at `/agent` and the current directory at `/workspace`.
- `--disable-containers` means the agent's `runCommand` tool executes commands **directly in the container** (not nested docker-in-docker). This is correct.
- `node_modules` from the host project are available via the `/workspace` mount, so `npm test` / `npx vitest` work.

### Interference Risks (Multiple Concurrent Containers)

| Risk                       | Why                                                 | Fix                                                    |
| -------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| Shared `agent_work` volume | All containers mount the same `$HOME/agent_work`    | Use per-container tmp or per-project subdir            |
| Hardcoded DNS              | All containers forced to same resolver              | Make DNS optional / per-network                        |
| No unique container name   | `docker run` auto-names, but logs/debugging collide | Generate unique name from project hash                 |
| Port conflicts             | If agent starts servers on fixed ports              | Use random ports or `--network none` for pure-CPU work |
| No process management      | Can't inspect/attach to long-running processes      | Add `tmux`                                             |

## Recommended Changes

### 1. Updated Dockerfile

```dockerfile
FROM node:24-alpine3.23

# Core utilities
RUN apk add --no-cache \
    ripgrep the_silver_searcher git bash grep curl findutils \
    tmux make cmake jq tree htop unzip wget \
    sqlite openssl procps \
    python3 patch php

# Node tooling
RUN npm install -g @vtsls/language-server oxfmt oxlint typescript

# Build helper (installs html-to-markdown)
COPY build.sh ./
RUN ./build.sh

# Default workdir
WORKDIR /workspace
```

**Why each addition:**

| Package          | Purpose                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `tmux`           | Manage long-running processes, attach/detach sessions, run multiple panes (e.g., test watcher + server) |
| `make` / `cmake` | Common build systems the agent may invoke                                                               |
| `jq`             | JSON manipulation (agent deals with JSON APIs, configs)                                                 |
| `tree`           | Quick directory exploration                                                                             |
| `htop`           | Monitor resource usage of running processes                                                             |
| `unzip` / `wget` | Download and extract dependencies, release binaries                                                     |
| `sqlite`         | Database testing (provides `sqlite3` binary)                                                            |
| `openssl`        | SSL/TLS debugging, certificate inspection                                                               |
| `procps`         | Provides `ps`, `kill`, `pgrep` — essential for process management                                       |

### 2. Updated `start-docker.sh`

```bash
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

# --- Isolation: unique container name from project path hash ---
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

echo "Container: $CONTAINER_NAME"
echo "Workspace: $CURRENT_DIR"
echo "Agent work: $AGENT_WORK_DIR"
echo "Args: ${AGENT_args[*]}"

docker run -it --rm \
    --name "$CONTAINER_NAME" \
    "${DNS_ARGS[@]}" \
    -v "$SCRIPT_DIR":/agent:ro \
    -v "$HOME/.config/codingagent.json":/home/node/.config/codingagent.json:ro \
    --user $(id -u):$(id -g) \
    -v "$CURRENT_DIR":/workspace \
    -v "$AGENT_WORK_DIR":/workspace/.agent-work \
    -w /workspace \
    agent-runner:2 /agent/index.ts --yolo --disable-containers --no-intro "${AGENT_args[@]}"
```

**Key changes:**

| Change                          | Why                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `--name agent-<hash>`           | Unique, deterministic name per project → no collisions, easy to `docker exec` into |
| Per-project `agent_work` subdir | Eliminates shared-state interference between concurrent containers                 |
| `:ro` on agent source & config  | Prevents accidental writes to the agent itself or global config                    |
| Conditional DNS                 | Doesn't break if the resolver is unreachable (e.g., different network)             |
| `set -euo pipefail`             | Fail fast on errors                                                                |

### 3. Attaching to a Running Container (tmux workflow)

Once the agent starts a long-running process (e.g., a dev server or test watcher), you can:

```bash
# Find the container
docker ps --filter "name=agent-" --format '{{.Names}}'

# Attach a tmux session inside the container
docker exec -it agent-<hash> tmux attach

# Or start a new tmux session in the container
docker exec -it agent-<hash> tmux new-session -s debug

# List processes
docker exec -it agent-<hash> htop

# Stop a specific process
docker exec -it agent-<hash> pkill -f "vitest"
```

Alternatively, the **agent itself** can use tmux internally:

```bash
# Agent runs a test suite in a tmux session
tmux new-session -d -s tests "npm test 2>&1 | tee /tmp/test-output.log"

# Check results later
tmux capture-pane -t tests -p
```

This is useful when the agent needs to kick off a long process and check on it later without blocking.

### 4. Running Full Tests

Since `$PWD` is mounted at `/workspace` and `node_modules` lives there:

```bash
# From the host, in your project directory:
yolo --yes-i-am-sure -q "Run the full test suite and report failures"

# The agent will execute:
#   cd /workspace && npx vitest run
#   (or whatever the project's test script is)
```

If the project needs native modules or a specific Node version, the host's `node_modules` are already built for the host architecture. For fully reproducible test runs, consider adding a `--fresh-deps` flag that runs `npm ci` inside the container first.

### 5. Multi-Project Parallel Execution

```bash
# Terminal 1: agent working on project A
cd ~/projects/alpha && yolo --yes-i-am-sure -q "Fix the failing tests"

# Terminal 2: agent working on project B
cd ~/projects/beta && yolo --yes-i-am-sure -q "Add a new feature"
```

These run as **fully isolated containers**:

- Different `/workspace` mounts (different host dirs)
- Different `.agent-work` dirs
- Different container names
- No shared ports (unless explicitly exposed)
- Independent process trees

### 6. Optional: Docker Compose for Reproducible Environments

For projects that need specific service dependencies (databases, message queues):

```yaml
# docker-compose.agent.yml (in project root)
services:
    agent:
        image: agent-runner:2
        volumes:
            - ./:/workspace
            - ./agent-work:/workspace/.agent-work
        working_dir: /workspace
        command: /agent/index.ts --yolo --disable-containers --no-intro
        depends_on:
            - db
    db:
        image: postgres:16
        environment:
            POSTGRES_PASSWORD: test
        ports:
            - '5432:5432'
```

## Summary of Files to Change

| File              | Change                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `Dockerfile`      | Add `tmux make cmake jq tree htop unzip wget sqlite3 openssl procps`                                |
| `start-docker.sh` | Add unique container name, per-project work dir, `:ro` mounts, conditional DNS, `set -euo pipefail` |
| `build-docker.sh` | Rebuild after Dockerfile change: `docker build -t agent-runner:3 .`                                 |
| `runner.md`       | This document                                                                                       |

## Verification Checklist

- [ ] `docker build -t agent-runner:3 .` succeeds
- [ ] `docker run --rm agent-runner:3 tmux -V` prints version
- [ ] `docker run --rm agent-runner:3 make --version` works
- [ ] Two concurrent `yolo` invocations in different dirs don't conflict
- [ ] `docker exec -it agent-<hash> tmux new-session` works while agent is running
- [ ] `npx vitest run` completes successfully inside the container
