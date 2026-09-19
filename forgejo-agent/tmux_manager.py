"""Tmux session management for agent workers.

Single shared tmux session; every in-progress issue runs in its own window.
Multiple daemon instances (one per repo) share this session. Windows are named
"{repo}-{branch}" so they stay unique across repos, and each daemon only ever
touches its own repo's windows.
"""

import os
import re
import shlex
import subprocess
import logging
from pathlib import Path

from git_ops import ssh_env, safe
from models import Session

logger = logging.getLogger(__name__)

TMUX_SESSION = "ai-agent"


def _branch_for_issue(issue_num: int) -> str:
    """Default branch name for an issue (matches create_worktree)."""
    return f"issue-{issue_num}"


def _window_name(repo: str, branch: str) -> str:
    """Window name for a repo+branch inside the shared tmux session."""
    return f"{repo}-{branch}"


def _win_for_issue(repo: str, issue_num: int) -> str:
    """Window name for an issue in `repo` (branch defaults to issue-N)."""
    return _window_name(repo, _branch_for_issue(issue_num))


def _list_window_names() -> list:
    r = subprocess.run(["tmux", "list-windows", "-t", TMUX_SESSION, "-F", "#{window_name}"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return []
    return [line.strip() for line in r.stdout.splitlines() if line.strip()]


def _is_my_window(repo: str, name: str) -> bool:
    """True if `name` belongs to this repo's daemon.

    Windows are named "{repo}-issue-N". Match precisely (fullmatch) so a repo
    whose name is a prefix of another's (e.g. 'my' vs 'my-cool') never steals
    the other's windows.
    """
    return re.fullmatch(re.escape(repo) + r"-issue-\d+", name) is not None


def docker_start_script() -> str:
    """Absolute path to start-docker.sh.

    The daemon runs from the *target* repo, but start-docker.sh lives in the
    agent3 repo (a different checkout), so point AGENT_DOCKER_START_SCRIPT at
    its absolute path. Falls back to the target repo's own copy if present
    (e.g. when the daemon runs inside agent3 itself).
    """
    env = os.environ.get("AGENT_DOCKER_START_SCRIPT")
    if env:
        if not Path(env).exists():
            raise RuntimeError(f"AGENT_DOCKER_START_SCRIPT does not exist: {env}")
        return env
    top = safe(lambda: subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    ).stdout.strip(), os.getcwd())
    candidate = Path(top) / "start-docker.sh"
    if candidate.exists():
        return str(candidate)
    raise RuntimeError(
        "start-docker.sh not found in the target repo. It lives in the agent3 "
        "repo — set AGENT_DOCKER_START_SCRIPT to its absolute path."
    )


def launch_agent(worktree_path: str, session: Session, resume: bool,
                 prompt_filename: str = ".agent/prompt.md") -> bool:
    """Start (or restart) the agent worker in a window of the shared tmux session.

    The worker is launched via start-docker.sh (runs the agent in a container),
    so prompt/session/log paths are relative to the worktree (mounted as /workspace).
    Returns success.
    """
    wt = worktree_path
    session_json = Path(wt) / ".agent" / "session.json"
    repo = session.repo_name
    branch = session.branch_name or _branch_for_issue(session.issue_number)
    win = _window_name(repo, branch)

    # start-docker.sh already forces --yolo --disable-containers --no-intro;
    # --yes-i-am-sure skips its interactive confirmation (we run non-interactively).
    parts = [docker_start_script(), "--yes-i-am-sure", "--mode", "run", "-y", "-f", prompt_filename]
    if resume and session_json.exists():
        parts += ["--continue", ".agent/session.json"]
    parts += ["--save", ".agent/session.json", "-l", ".agent/agent.log"]
    agent_cmd = " ".join(shlex.quote(p) for p in parts)
    shell_cmd = f"cd {shlex.quote(wt)} && {agent_cmd}"

    # Drop any stale window for this issue, then (re)create it in the shared session.
    kill_tmux(repo, session.issue_number)

    has_session = subprocess.run(["tmux", "has-session", "-t", TMUX_SESSION],
                                 capture_output=True, text=True).returncode == 0
    if has_session:
        cmd = ["tmux", "new-window", "-d", "-t", TMUX_SESSION, "-n", win, shell_cmd]
    else:
        cmd = ["tmux", "new-session", "-d", "-s", TMUX_SESSION, "-n", win, shell_cmd]

    logger.info(f"Launching agent for issue #{session.issue_number} "
                f"in '{TMUX_SESSION}:{win}' (resume={resume})")
    result = subprocess.run(cmd, capture_output=True, text=True, env=ssh_env())
    if result.returncode != 0:
        logger.error(f"Failed to start agent window: {result.stderr}")
        return False
    logger.info(f"Attach with: tmux attach -t {TMUX_SESSION}")
    return True


def tmux_running(repo: str, issue_num: int) -> bool:
    """True if the issue's window exists in the shared session."""
    return _win_for_issue(repo, issue_num) in _list_window_names()


def kill_tmux(repo: str, issue_num: int) -> None:
    subprocess.run(["tmux", "kill-window", "-t", f"{TMUX_SESSION}:{_win_for_issue(repo, issue_num)}"],
                   capture_output=True)


def live_agent_count(repo: str) -> int:
    """Count this repo's live agent windows."""
    return sum(1 for name in _list_window_names() if _is_my_window(repo, name))


def list_agent_windows(repo: str) -> list:
    """Return issue numbers (for this repo) that have a live window."""
    nums = []
    for name in _list_window_names():
        m = re.fullmatch(re.escape(repo) + r"-issue-(\d+)", name)
        if m:
            nums.append(int(m.group(1)))
    return nums


def kill_orphaned_sessions(state, repo: str) -> None:
    """Kill this repo's agent windows that are not tracked in the state file."""
    tracked = {s.issue_number for s in state.sessions.values()}
    orphans = [n for n in list_agent_windows(repo) if n not in tracked]
    for n in orphans:
        logger.warning(f"Killing orphaned agent window '{_win_for_issue(repo, n)}' (not in state)")
        kill_tmux(repo, n)
    if orphans:
        logger.info(f"Cleaned up {len(orphans)} orphaned window(s): {orphans}")
