"""Status comment and label management."""

import logging
from datetime import datetime

from config import CONFIG
from git_ops import git, get_default_branch
from forgejo_api import post_comment, edit_comment, add_labels, remove_labels
from forgejo_client import ForgejoError
from tmux_manager import TMUX_SESSION, _window_name, _branch_for_issue
from models import Session
from utils import safe, parse_iso, fmt_duration, read_log_tail

logger = logging.getLogger(__name__)


def set_labels(session: Session, add: list | None = None, remove: list | None = None) -> None:
    """Map friendly names ('processing','done',...) to config labels and apply."""
    n = session.issue_number
    owner, repo = session.repo_owner, session.repo_name
    add_full = [CONFIG[f"{x}_label"] for x in (add or [])]
    remove_full = [CONFIG[f"{x}_label"] for x in (remove or [])]
    safe(lambda: add_labels(owner, repo, n, add_full))
    safe(lambda: remove_labels(owner, repo, n, remove_full))


def build_status_text(session: Session) -> str:
    wt = session.worktree_path
    base = get_default_branch()
    now = datetime.now()
    started = parse_iso(session.started_at)
    elapsed = fmt_duration(now - started) if started else "?"

    icon = {"processing": "🟢", "waiting_clarification": "⏸️"}.get(session.status, "•")
    phase = {"processing": "Working", "waiting_clarification": "Waiting for clarification"}.get(
        session.status, session.status)

    commits = safe(lambda: git("rev-list", "--count", f"{base}..HEAD", cwd=wt), "?")
    diffstat = safe(lambda: git("diff", "--stat", f"{base}...HEAD", cwd=wt), "")
    diffstat = "\n".join((diffstat or "").splitlines()[-CONFIG["diffstat_max_lines"]:])
    logtail = read_log_tail(f"{wt}/.agent/agent.log", CONFIG["log_tail_lines"])

    lines = [
        "## 🤖 AI Agent Status",
        "",
        f"**State:** {icon} {phase}",
        f"**Elapsed:** {elapsed}",
        f"**Commits ahead of `{base}`:** {commits}",
    ]
    if diffstat:
        lines += ["", "**Changes:**", "```", diffstat, "```"]
    if logtail:
        lines += ["", "**Latest activity:**", "```", logtail, "```"]
    win = _window_name(session.repo_name, session.branch_name or _branch_for_issue(session.issue_number))
    lines += ["", f"_Session: `tmux attach -t {TMUX_SESSION}` (window `{win}`)_"]
    return "\n".join(lines)


def upsert_status_comment(owner: str, repo: str, session: Session, text: str) -> None:
    """Maintain a single editable status comment per PR (no spam)."""
    try:
        if session.status_comment_id:
            try:
                edit_comment(owner, repo, session.status_comment_id, text)
                return
            except ForgejoError as e:
                if e.kind != "notfound":
                    raise
        cid = post_comment(owner, repo, session.pr_number, text)
        if cid:
            session.status_comment_id = cid
    except ForgejoError as e:
        logger.warning(f"Failed to update status comment for PR #{session.pr_number}: {e}")
