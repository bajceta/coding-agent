"""PR command parsing and handling (/retry, /stop, /continue, /debug)."""

import re
import logging
from datetime import datetime

import config
from config import CONFIG
from models import AgentState
from utils import safe, write_file
from forgejo_api import get_open_prs, get_comments, post_comment, extract_issue_from_pr
from markers import ensure_agent_dir
from lifecycle import retry_issue, relaunch, set_labels, upsert_status_comment
from tmux_manager import kill_tmux

logger = logging.getLogger(__name__)


def parse_commands(text: str) -> list:
    """Parse /retry /continue /stop /debug anchored to the start of a line."""
    commands = []
    for line in (text or "").splitlines():
        m = re.match(r"^\s*/(retry|continue|stop|debug)\b\s*(.*)$", line)
        if m:
            commands.append({"command": m.group(1), "args": m.group(2).strip()})
    return commands


def handle_pr_command(pr_num: int, command: str, args: str, state: AgentState,
                      owner: str, repo: str) -> None:
    logger.info(f"PR #{pr_num}: handling /{command} {args}")
    issue_num = extract_issue_from_pr(pr_num, owner, repo)
    if not issue_num:
        safe(lambda: post_comment(owner, repo, pr_num, "❌ Could not determine the associated issue."))
        return
    sid = str(issue_num)

    if command == "retry":
        # Delegate to the unified retry handler (handles both existing and new sessions)
        retry_issue(issue_num, owner, repo, state, args=args, pr_num=pr_num)
        return

    if sid not in state.sessions:
        safe(lambda: post_comment(owner, repo, pr_num, f"❌ No active session for issue #{issue_num}."))
        return

    session = state.sessions[sid]
    wt = session.worktree_path
    ensure_agent_dir(wt)

    try:
        if command == "stop":
            kill_tmux(session.repo_name, issue_num)
            set_labels(session, add=["done"], remove=["processing", "waiting"])
            session.status = "done"
            session.finished_at = datetime.now().isoformat()
            safe(lambda: post_comment(owner, repo, pr_num, "🛑 Stopped by user."))
            upsert_status_comment(owner, repo, session, "## 🤖 AI Agent Status\n\n**State:** 🛑 Stopped")

        elif command == "continue":
            reply = "CONTINUE: Continue from where you left off." + (f" Context: {args}" if args else "")
            write_file(f"{wt}/.agent/reply.md", reply)
            relaunch(session, owner, repo, resume=True, prompt_filename=".agent/reply.md",
                     message="▶️ **Continued**.")

        elif command == "debug":
            reply = "DEBUG: Investigate the current state in detail and be verbose." + (
                f" Focus: {args}" if args else "")
            write_file(f"{wt}/.agent/reply.md", reply)
            relaunch(session, owner, repo, resume=True, prompt_filename=".agent/reply.md",
                     message="🔍 **Debug session** started.")

        state.save()
    except Exception as e:
        logger.error(f"Error handling /{command} on PR #{pr_num}: {e}", exc_info=True)
        safe(lambda: post_comment(owner, repo, pr_num, f"❌ Error: {e}"))


def prune_state(state: AgentState) -> None:
    limit = CONFIG["max_processed_comments"]
    if len(state.processed_comments) > limit:
        items = sorted(state.processed_comments.items(), key=lambda kv: kv[1])
        for k, _ in items[: len(items) - limit]:
            del state.processed_comments[k]


def check_pr_commands(state: AgentState, owner: str, repo: str) -> None:
    for pr in safe(lambda: get_open_prs(owner, repo), []):
        pr_num = pr.get("number") if isinstance(pr, dict) else None
        if not pr_num:
            continue
        for c in safe(lambda: get_comments(owner, repo, pr_num), []):
            if not isinstance(c, dict):
                continue
            cid = c.get("id", 0)
            body = c.get("body", "") or ""
            if c.get("user", {}).get("login") == config.BOT_LOGIN:
                continue  # ignore our own comments
            cmd_id = f"pr-{pr_num}-c-{cid}"
            if cmd_id in state.processed_comments:
                continue
            commands = parse_commands(body)
            if not commands:
                continue
            for cmd in commands:
                handle_pr_command(pr_num, cmd["command"], cmd["args"], state, owner, repo)
            state.processed_comments[cmd_id] = datetime.now().isoformat()
    prune_state(state)
    state.last_pr_check = datetime.now().isoformat()
    state.save()
