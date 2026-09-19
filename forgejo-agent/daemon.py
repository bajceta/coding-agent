"""Daemon poll loop and new-issue scanning."""

import signal
import time
import logging
from datetime import datetime

from config import CONFIG
from models import AgentState
from git_ops import get_repo_info
from forgejo_client import validate_token
from forgejo_api import get_assigned_issues, post_comment, add_labels
from tmux_manager import kill_orphaned_sessions, tmux_running, live_agent_count
from lifecycle import process_new_issue, reconcile_sessions
from commands import check_pr_commands
from utils import safe

logger = logging.getLogger(__name__)


def check_new_issues(state: AgentState, owner: str, repo: str) -> None:
    for issue in safe(lambda: get_assigned_issues(owner, repo), []):
        if not isinstance(issue, dict):
            continue
        n = issue.get("number")
        if n is None:
            continue
        sid = str(n)
        if sid in state.sessions:
            continue
        if tmux_running(repo, n):
            logger.info(f"Issue #{n} already has a running session; skipping")
            continue
        if live_agent_count(repo) >= CONFIG["max_concurrent_sessions"]:
            logger.info(f"At capacity ({CONFIG['max_concurrent_sessions']}); deferring issue #{n}")
            continue
        try:
            process_new_issue(issue, state, owner, repo)
        except Exception as e:
            logger.error(f"Error processing issue #{n}: {e}", exc_info=True)
            safe(lambda: post_comment(owner, repo, n, f"❌ Failed to start: {e}"))
            safe(lambda: add_labels(owner, repo, n, [CONFIG["failed_label"]]))
    state.last_issue_check = datetime.now().isoformat()
    state.save()


def run_daemon(interval: int) -> None:
    owner, repo, _ = get_repo_info()
    logger.info(f"Repository: {owner}/{repo}")
    validate_token()

    state = AgentState.load()
    logger.info(f"Loaded state: {len(state.sessions)} sessions")

    running = True

    def handler(sig, frame):
        nonlocal running
        logger.info("Shutdown signal received; stopping...")
        running = False

    signal.signal(signal.SIGINT, handler)
    signal.signal(signal.SIGTERM, handler)

    while running:
        try:
            kill_orphaned_sessions(state, repo)
            reconcile_sessions(state, owner, repo)
            check_new_issues(state, owner, repo)
            check_pr_commands(state, owner, repo)
        except Exception as e:
            logger.error(f"Error in poll loop: {e}", exc_info=True)
        for _ in range(interval):
            if not running:
                break
            time.sleep(1)
    logger.info("Daemon stopped.")
