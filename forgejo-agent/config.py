"""Configuration constants and environment parsing."""

import os
import sys
import logging
from pathlib import Path


def _env_int(name: str, default: int) -> int:
    v = os.environ.get(name)
    try:
        return int(v) if v else default
    except ValueError:
        return default


CONFIG = {
    "assignee": "aiagent",
    "processing_label": "ai:processing",
    "waiting_label": "ai:waiting",
    "done_label": "ai:done",
    "failed_label": "ai:failed",
    "poll_interval": _env_int("AGENT_POLL_INTERVAL", 10),
    "max_concurrent_sessions": _env_int("AGENT_MAX_CONCURRENT", 4),
    "max_runtime_minutes": _env_int("AGENT_MAX_RUNTIME_MIN", 180),
    "auto_cleanup_grace_hours": _env_int("AGENT_CLEANUP_GRACE_HOURS", 0),  # 0 = disabled
    "max_processed_comments": 2000,
    "worktree_base": os.environ.get("AGENT_WORKTREE_BASE", "../"),
    "agent_binary": os.environ.get("AGENT_BINARY", "agent"),
    "ssh_key_env": "AGENT_SSH_KEY",
    "log_tail_lines": 10,
    "diffstat_max_lines": 15,
}

# Forgejo API settings
FORGEJO = {
    "host": os.environ.get("FORGEJO_HOST", "forgejo.innercore.se"),
    "api_base": os.environ.get("FORGEJO_API_BASE", "https://forgejo.innercore.se/api/v1"),
    "token_env": "FORGEJO_TOKEN",
}

# State file (git-ignored)
STATE_FILE = Path("ai-agent-state.json")

# Login of the account that owns FORGEJO_TOKEN (set at startup). Used to
# ignore the bot's own comments when scanning for human replies / commands.
# Access via `config.BOT_LOGIN` (module attribute) so runtime mutation is visible.
BOT_LOGIN: str | None = None

# Logging setup
logging.basicConfig(
    level=os.environ.get("AGENT_LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("ai-agent.log"),
    ],
)

# Instructions embedded in every agent prompt. Defines the marker-file
# protocol so the daemon can unambiguously detect how a run ended.
PREAMBLE = """\
You are an autonomous coding agent running inside a Docker container.
Your working directory is a git worktree — treat it as your project root.

## Environment

- You are in a Linux container (Debian-based). No GUI, no browser.
- Git is fully functional: `git push`, `git pull`, `git fetch` all work.
- Available tools: bash, git, node, npm, pnpm, standard Unix utilities (grep, sed, awk, curl, etc.).
- NOT available: docker, podman, kubectl, GUI tools, package managers other than node/pnpm.
- The `.agent/` directory is reserved for the daemon protocol — do not store project files there.

## Rules (follow strictly)

1. Work only in the current directory (the worktree).
2. When the task is COMPLETE:
   - run:  git add -A && git commit -m "<clear, descriptive message>" && git push
   - write a short summary (what you changed and how to verify it) to the file: .agent/done.md
   - STOP (end your run).
3. If you are BLOCKED or UNCERTAIN about the requirements and cannot proceed safely:
   - DO NOT guess. Write your specific question(s) to the file: .agent/clarification.md
   - STOP (end your run). A human will reply and you will be resumed with that answer.
4. On a FATAL error you cannot recover from:
   - write the error and what you tried to the file: .agent/error.md
   - STOP (end your run).

Always end your run by writing EXACTLY ONE of: .agent/done.md, .agent/clarification.md, .agent/error.md.
Use `git` commands directly (there is no `task` runner).
"""
