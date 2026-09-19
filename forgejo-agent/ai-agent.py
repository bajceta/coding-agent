#!/usr/bin/env python3
"""
Forgejo AI Agent Daemon (hardened)

Polls Forgejo for:
  - New issues assigned to 'aiagent'
  - PR comments containing /retry, /continue, /stop, /debug commands

For each issue it creates a git worktree + PR, launches the agent worker
(start-docker.sh, which runs the agent in a container) as a window in a shared
tmux session (windows named "{repo}-{branch}"; multiple daemons, one per repo,
share the session), surfaces live progress
in a single editable PR "status" comment, lets the agent ask for clarification
in Forgejo comments when it is blocked, and resumes automatically when a human
replies.

Agent <-> daemon protocol (files under <worktree>/.agent/, git-ignored):
  prompt.md          input : the task (written by the daemon)
  reply.md           input : a human's clarification answer (resume)
  session.json       agent conversation (saved/resumed via --save/--continue)
  agent.log          agent log (source of progress shown in the PR)
  done.md            agent -> daemon : success + summary  (terminal)
  clarification.md   agent -> daemon : question(s), run paused (terminal)
  error.md           agent -> daemon : failure + reason  (terminal)
"""

import subprocess
import json
import os
import sys
import time
import re
import logging
import signal
import argparse
import random
import shlex
import shutil
import urllib.request
import urllib.error
from urllib.parse import urlencode
from pathlib import Path
from datetime import datetime, timedelta
from dataclasses import dataclass, field, fields
from typing import Optional

# ─── Configuration ─────────────────────────────────────────────


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
BOT_LOGIN: Optional[str] = None

# Logging setup
logging.basicConfig(
    level=os.environ.get("AGENT_LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("ai-agent.log"),
    ],
)
logger = logging.getLogger(__name__)

# Instructions embedded in every agent prompt. Defines the marker-file
# protocol so the daemon can unambiguously detect how a run ended.
PREAMBLE = """\
You are an autonomous coding agent working inside a git worktree (your current directory).
Follow these rules strictly:

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

# ─── Small helpers ─────────────────────────────────────────────


def _safe(fn, default=None):
    """Run fn; return default on any exception (logs a warning)."""
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"_safe: {e}")
        return default


def parse_iso(s: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def fmt_duration(td: timedelta) -> str:
    total = int(td.total_seconds())
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m}m"
    if m:
        return f"{m}m {s}s"
    return f"{s}s"


ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def sanitize(text: str) -> str:
    return ANSI_RE.sub("", text or "")


def write_file(path, content: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)


def read_log_tail(path, n: int = 10) -> str:
    try:
        lines = Path(path).read_text(errors="ignore").splitlines()
    except (FileNotFoundError, OSError):
        return ""
    return sanitize("\n".join(lines[-n:])).strip()


# ─── Data Models ───────────────────────────────────────────────


@dataclass
class Session:
    issue_number: int
    pr_number: Optional[int] = None
    branch_name: str = ""
    worktree_path: str = ""
    status: str = "processing"  # processing | waiting_clarification | done | failed
    started_at: str = ""
    last_activity: str = ""
    agent_prompt: str = ""
    error: Optional[str] = None
    repo_owner: str = ""
    repo_name: str = ""
    status_comment_id: Optional[int] = None
    clarification_comment_id: Optional[int] = None
    last_seen_comment_id: int = 0
    finished_at: Optional[str] = None


@dataclass
class AgentState:
    sessions: dict = field(default_factory=dict)
    processed_comments: dict = field(default_factory=dict)  # {cmd_id: iso_ts}
    last_issue_check: str = ""
    last_pr_check: str = ""

    def to_dict(self) -> dict:
        return {
            "sessions": {k: v.__dict__ for k, v in self.sessions.items()},
            "processed_comments": self.processed_comments,
            "last_issue_check": self.last_issue_check,
            "last_pr_check": self.last_pr_check,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "AgentState":
        known = {f.name for f in fields(Session)}
        sessions = {}
        for k, v in (data.get("sessions") or {}).items():
            if isinstance(v, dict):
                filtered = {kk: vv for kk, vv in v.items() if kk in known}
                sessions[k] = Session(**filtered)
        # Normalize processed_comments: accept dict {id: ts} or legacy list [id, ...]
        pc = data.get("processed_comments") or {}
        if isinstance(pc, list):
            pc = {item: "" for item in pc if isinstance(item, str)}
        elif not isinstance(pc, dict):
            pc = {}

        return cls(
            sessions=sessions,
            processed_comments=pc,
            last_issue_check=data.get("last_issue_check", ""),
            last_pr_check=data.get("last_pr_check", ""),
        )

    def save(self) -> None:
        # Atomic write: temp file + rename so a crash never corrupts state.
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.to_dict(), indent=2))
        os.replace(tmp, STATE_FILE)

    @classmethod
    def load(cls) -> "AgentState":
        if STATE_FILE.exists():
            try:
                return cls.from_dict(json.loads(STATE_FILE.read_text()))
            except Exception as e:  # noqa: BLE001
                logger.warning(f"Failed to load state ({e}); starting fresh")
        return cls()


# ─── Low-level command wrappers ────────────────────────────────


def run_cmd(cmd, check: bool = True, cwd: Optional[str] = None, env: Optional[dict] = None) -> str:
    """Run a command, return stripped stdout."""
    logger.debug(f"Running: {' '.join(map(str, cmd))} (cwd={cwd})")
    result = subprocess.run(
        [str(c) for c in cmd],
        capture_output=True,
        text=True,
        check=False,
        cwd=cwd,
        env=env,
    )
    if check and result.returncode != 0:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {' '.join(map(str, cmd))}\nSTDERR: {result.stderr.strip()}"
        )
    return result.stdout.strip()


def git(*args, cwd: Optional[str] = None, env: Optional[dict] = None) -> str:
    return run_cmd(["git"] + list(args), cwd=cwd, env=env)


def ssh_env() -> dict:
    env = os.environ.copy()
    key = os.environ.get(CONFIG["ssh_key_env"])
    if key:
        env["GIT_SSH_COMMAND"] = f"ssh -i {key}"
    return env


# ─── Forgejo API client ────────────────────────────────────────


class ForgejoError(Exception):
    def __init__(self, message: str, kind: str = "other", code: Optional[int] = None, body: str = ""):
        super().__init__(message)
        self.kind = kind  # auth | notfound | network | server | other
        self.code = code
        self.body = body


def get_forgejo_token() -> str:
    return os.environ.get(FORGEJO["token_env"], "")


def forgejo_request(method: str, endpoint: str, params: Optional[dict] = None,
                    json_body: Optional[dict] = None, retries: int = 3):
    """Perform an authenticated request with retry/backoff on transient errors."""
    token = get_forgejo_token()
    if not token:
        raise ForgejoError("FORGEJO_TOKEN not set", kind="auth")

    url = f"{FORGEJO['api_base']}{endpoint}"
    if params:
        url = f"{url}?{urlencode(params)}"

    headers = {"Authorization": f"token {token}", "Accept": "application/json"}
    data = None
    if json_body is not None:
        data = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"

    last_exc: Optional[Exception] = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode(errors="ignore")
            except Exception:  # noqa: BLE001
                pass
            if e.code in (401, 403):
                raise ForgejoError(f"Authentication failed ({e.code})", kind="auth", code=e.code, body=body)
            if e.code == 404:
                raise ForgejoError("Not found", kind="notfound", code=e.code, body=body)
            if 500 <= e.code < 600:
                last_exc = ForgejoError(f"Server error {e.code}", kind="server", code=e.code, body=body)
            else:
                raise ForgejoError(f"HTTP {e.code}", kind="other", code=e.code, body=body)
        except urllib.error.URLError as e:
            last_exc = ForgejoError(f"Network error: {e.reason}", kind="network")
        except Exception as e:  # noqa: BLE001
            raise ForgejoError(f"Request failed: {e}", kind="other")

        # Exponential backoff with jitter before retrying transient errors.
        time.sleep(min(2 ** attempt, 10) + random.uniform(0, 0.5))

    raise last_exc  # type: ignore[misc]


def fj_get(endpoint: str, params: Optional[dict] = None):
    return forgejo_request("GET", endpoint, params=params)


def fj_post(endpoint: str, json_body: Optional[dict] = None):
    return forgejo_request("POST", endpoint, json_body=json_body)


def fj_patch(endpoint: str, json_body: Optional[dict] = None):
    return forgejo_request("PATCH", endpoint, json_body=json_body)


def fj_delete(endpoint: str):
    return forgejo_request("DELETE", endpoint)


def validate_token() -> str:
    """Authenticate once at startup; abort early on failure. Returns bot login."""
    try:
        me = fj_get("/user")
        login = me.get("login", "unknown") if isinstance(me, dict) else "unknown"
        logger.info(f"Authenticated with Forgejo as '{login}'")
        return login
    except ForgejoError as e:
        logger.error(f"Forgejo authentication failed: {e}")
        logger.error("Check that FORGEJO_TOKEN is set and valid.")
        sys.exit(1)


# ─── Forgejo high-level helpers ────────────────────────────────


def _is_assigned_to(issue: dict, login: str) -> bool:
    """True if the issue is assigned to `login` (single assignee or assignees list)."""
    a = issue.get("assignee")
    if isinstance(a, dict) and a.get("login") == login:
        return True
    for x in issue.get("assignees") or []:
        if isinstance(x, dict) and x.get("login") == login:
            return True
    return False


def get_assigned_issues(owner: str, repo: str) -> list:
    """Open issues (not PRs) assigned to the agent.

    The /issues endpoint returns both issues and PRs, and the server-side
    ``assignees`` filter is not honoured by all Gitea/Forgejo versions, so both
    the PR exclusion and the assignee match are enforced client-side.
    """
    data = fj_get(f"/repos/{owner}/{repo}/issues",
                  {"state": "open", "assignees": CONFIG["assignee"]})
    if not isinstance(data, list):
        return []
    out = []
    for i in data:
        if not isinstance(i, dict):
            continue
        # PR detection: some versions always emit a `pull_request` key (null for
        # issues, object for PRs). Check the VALUE, not key presence, so real
        # issues are not dropped.
        if i.get("pull_request") is not None:
            continue
        if not _is_assigned_to(i, CONFIG["assignee"]):
            continue
        out.append(i)
    return out


def get_comments(owner: str, repo: str, number: int) -> list:
    data = fj_get(f"/repos/{owner}/{repo}/issues/{number}/comments", {"limit": 50})
    return data if isinstance(data, list) else []


def post_comment(owner: str, repo: str, number: int, body: str) -> Optional[int]:
    data = fj_post(f"/repos/{owner}/{repo}/issues/{number}/comments", {"body": body})
    return data.get("id") if isinstance(data, dict) else None


def edit_comment(owner: str, repo: str, comment_id: int, body: str) -> None:
    fj_patch(f"/repos/{owner}/{repo}/issues/{comment_id}", {"body": body})


def get_open_prs(owner: str, repo: str) -> list:
    data = fj_get(f"/repos/{owner}/{repo}/pulls", {"state": "open"})
    return data if isinstance(data, list) else []


def add_labels(owner: str, repo: str, number: int, labels: list) -> None:
    if labels:
        fj_post(f"/repos/{owner}/{repo}/issues/{number}/labels", {"labels": labels})


def remove_labels(owner: str, repo: str, number: int, names: list) -> None:
    if not names:
        return
    current = fj_get(f"/repos/{owner}/{repo}/issues/{number}/labels")
    for lab in current if isinstance(current, list) else []:
        if isinstance(lab, dict) and lab.get("name") in names:
            fj_delete(f"/repos/{owner}/{repo}/issues/{number}/labels/{lab['id']}")


# ─── Repo info ─────────────────────────────────────────────────

_default_branch_cache: Optional[str] = None
_remote_cache: Optional[str] = None


def get_remote() -> str:
    """Detect the git remote name to use for push/fetch.

    Priority:
      1. FORGEJO_REMOTE env var (explicit override)
      2. 'origin' (conventional default)
      3. First remote whose URL contains the Forgejo host
      4. First remote (fallback)
    """
    global _remote_cache
    if _remote_cache is not None:
        return _remote_cache

    env_remote = os.environ.get("FORGEJO_REMOTE")
    if env_remote:
        _remote_cache = env_remote
        return _remote_cache

    try:
        remotes = git("remote")
    except Exception:
        remotes = ""

    names = [r.strip() for r in remotes.splitlines() if r.strip()]

    if "origin" in names:
        _remote_cache = "origin"
        return _remote_cache

    # Look for a remote pointing to the Forgejo host
    host = FORGEJO["host"]
    for name in names:
        try:
            url = git("remote", "get-url", name)
        except Exception:
            continue
        if host in url:
            _remote_cache = name
            return _remote_cache

    if names:
        _remote_cache = names[0]
        logger.warning(f"No 'origin' or Forgejo-matching remote found; using first remote: '{_remote_cache}'")
        return _remote_cache

    raise RuntimeError("No git remotes configured and FORGEJO_REMOTE not set.")


def get_default_branch() -> str:
    """Detect the default branch from the remote; fall back to 'main'."""
    global _default_branch_cache
    if _default_branch_cache is not None:
        return _default_branch_cache
    remote = get_remote()
    try:
        output = git("remote", "show", remote)
        m = re.search(r"HEAD branch:\s+(\S+)", output)
        if m:
            _default_branch_cache = m.group(1)
            return _default_branch_cache
    except Exception:  # noqa: BLE001
        pass
    try:
        output = git("symbolic-ref", f"refs/remotes/{remote}/HEAD")
        _default_branch_cache = output.rsplit("/", 1)[-1]
        return _default_branch_cache
    except Exception:  # noqa: BLE001
        pass
    logger.warning("Could not detect default branch; falling back to 'main'")
    _default_branch_cache = "main"
    return _default_branch_cache


def get_repo_info() -> tuple:
    """Owner/repo from env (preferred) or the git remote; local path from git."""
    o = os.environ.get("FORGEJO_OWNER")
    r = os.environ.get("FORGEJO_REPO")
    if o and r:
        top = _safe(lambda: git("rev-parse", "--show-toplevel"), os.getcwd())
        return o, r, top
    try:
        url = git("remote", "get-url", get_remote())
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(
            "No suitable git remote and FORGEJO_OWNER/FORGEJO_REPO not set. "
            "Set the env vars or add a remote."
        ) from e
    m = re.search(r"[:/]([^/:]+)/([^/]+?)(?:\.git)?$", url)
    if not m:
        raise RuntimeError(f"Could not parse owner/repo from remote URL: {url}")
    top = _safe(lambda: git("rev-parse", "--show-toplevel"), os.getcwd())
    return m.group(1), m.group(2), top


# ─── Worktree / PR ─────────────────────────────────────────────


def create_worktree(issue_num: int, repo: str, base_branch: str) -> tuple:
    """Create (or reuse) a worktree. Returns (worktree_path, branch_name)."""
    branch_name = f"issue-{issue_num}"
    worktree_dir = Path(CONFIG["worktree_base"]) / f"{repo}-{issue_num}"
    if worktree_dir.exists():
        logger.info(f"Reusing existing worktree at {worktree_dir}")
        return str(worktree_dir), branch_name

    logger.info(f"Creating worktree {worktree_dir} (branch {branch_name}, base {base_branch})")
    try:
        git("worktree", "add", "-B", branch_name, str(worktree_dir), base_branch)
    except RuntimeError as e:
        if "already used by worktree" in str(e):
            logger.warning(f"Branch {branch_name} held by a stale worktree; pruning...")
            git("worktree", "prune")
            if worktree_dir.exists():
                return str(worktree_dir), branch_name
            git("worktree", "add", "-B", branch_name, str(worktree_dir), base_branch)
        else:
            raise
    return str(worktree_dir), branch_name


def install_dependencies(worktree_path: str) -> None:
    logger.info(f"Installing dependencies in {worktree_path}")
    run_cmd(["pnpm", "install"], cwd=worktree_path)


def create_pr(owner: str, repo: str, title: str, body: str, head: str, base: str,
              worktree_path: str) -> int:
    """Push the branch, then open a PR via the API. Returns the PR number."""
    remote = get_remote()
    logger.info(f"Pushing branch {head} to {remote}")
    run_cmd(["git", "push", "-u", remote, head], cwd=worktree_path, env=ssh_env())
    data = fj_post(f"/repos/{owner}/{repo}/pulls",
                   {"title": title, "body": body, "head": head, "base": base})
    num = data.get("number") if isinstance(data, dict) else None
    if not num:
        raise RuntimeError(f"PR creation returned no number: {data}")
    logger.info(f"Created PR #{num} for branch {head}")
    return num


def find_existing_pr(branch_name: str, owner: str, repo: str) -> Optional[int]:
    for pr in _safe(lambda: get_open_prs(owner, repo), []):
        if isinstance(pr, dict) and pr.get("head", {}).get("ref") == branch_name:
            return pr.get("number")
    return None


# ─── Agent <-> daemon protocol ─────────────────────────────────


def ensure_agent_dir(worktree_path: str) -> Path:
    """Create <worktree>/.agent and git-ignore its contents."""
    d = Path(worktree_path) / ".agent"
    d.mkdir(parents=True, exist_ok=True)
    gi = d / ".gitignore"
    if not gi.exists():
        gi.write_text("*\n")
    return d


def marker_exists(worktree_path: str, name: str) -> bool:
    return (Path(worktree_path) / ".agent" / name).exists()


def read_marker(worktree_path: str, name: str) -> str:
    try:
        return (Path(worktree_path) / ".agent" / name).read_text(errors="ignore").strip()
    except (FileNotFoundError, OSError):
        return ""


# Single shared tmux session; every in-progress issue runs in its own window.
# Multiple daemon instances (one per repo) share this session. Windows are named
# "{repo}-{branch}" so they stay unique across repos, and each daemon only ever
# touches its own repo's windows.
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
    top = _safe(lambda: git("rev-parse", "--show-toplevel"), os.getcwd())
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


def kill_orphaned_sessions(state: AgentState, repo: str) -> None:
    """Kill this repo's agent windows that are not tracked in the state file."""
    tracked = {s.issue_number for s in state.sessions.values()}
    orphans = [n for n in list_agent_windows(repo) if n not in tracked]
    for n in orphans:
        logger.warning(f"Killing orphaned agent window '{_win_for_issue(repo, n)}' (not in state)")
        kill_tmux(repo, n)
    if orphans:
        logger.info(f"Cleaned up {len(orphans)} orphaned window(s): {orphans}")


# ─── Labels ────────────────────────────────────────────────────


def set_labels(session: Session, add: Optional[list] = None, remove: Optional[list] = None) -> None:
    """Map friendly names ('processing','done',...) to config labels and apply."""
    n = session.issue_number
    owner, repo = session.repo_owner, session.repo_name
    add_full = [CONFIG[f"{x}_label"] for x in (add or [])]
    remove_full = [CONFIG[f"{x}_label"] for x in (remove or [])]
    _safe(lambda: add_labels(owner, repo, n, add_full))
    _safe(lambda: remove_labels(owner, repo, n, remove_full))


# ─── Status comment (live progress in the PR) ──────────────────


def build_status_text(session: Session) -> str:
    wt = session.worktree_path
    base = get_default_branch()
    now = datetime.now()
    started = parse_iso(session.started_at)
    elapsed = fmt_duration(now - started) if started else "?"

    icon = {"processing": "🟢", "waiting_clarification": "⏸️"}.get(session.status, "•")
    phase = {"processing": "Working", "waiting_clarification": "Waiting for clarification"}.get(
        session.status, session.status)

    commits = _safe(lambda: git("rev-list", "--count", f"{base}..HEAD", cwd=wt), "?")
    diffstat = _safe(lambda: git("diff", "--stat", f"{base}...HEAD", cwd=wt), "")
    diffstat = "\n".join((diffstat or "").splitlines()[-CONFIG["diffstat_max_lines"]:])
    logtail = read_log_tail(Path(wt) / ".agent" / "agent.log", CONFIG["log_tail_lines"])

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


# ─── Issue processing ──────────────────────────────────────────


def process_new_issue(issue: dict, state: AgentState, owner: str, repo: str) -> Optional[Session]:
    issue_num = issue["number"]
    title = issue.get("title", "")
    body = issue.get("body", "") or ""
    logger.info(f"Processing issue #{issue_num}: {title}")

    base = get_default_branch()
    wt, branch = create_worktree(issue_num, repo, base)

    if (Path(wt) / "pnpm-lock.yaml").exists():
        _safe(lambda: install_dependencies(wt))

    try:
        pr_num = create_pr(owner, repo, f"WIP: {title}", f"{body}\n\ncloses #{issue_num}",
                           branch, base, wt)
    except ForgejoError as e:
        logger.warning(f"PR creation failed ({e}); searching for an existing PR")
        pr_num = find_existing_pr(branch, owner, repo)
        if pr_num is None:
            raise RuntimeError(f"Could not create or find PR for branch {branch}: {e}") from e
        logger.info(f"Found existing PR #{pr_num} for branch {branch}")

    # Write the task prompt (marker files live in .agent/, git-ignored).
    ensure_agent_dir(wt)
    task = f"Title: {title}\n\nBody:\n{body}"
    write_file(Path(wt) / ".agent" / "prompt.md", PREAMBLE + "\n---\n\n## TASK\n" + task)

    session = Session(
        issue_number=issue_num,
        pr_number=pr_num,
        branch_name=branch,
        worktree_path=wt,
        status="processing",
        started_at=datetime.now().isoformat(),
        last_activity=datetime.now().isoformat(),
        agent_prompt=task,
        repo_owner=owner,
        repo_name=repo,
    )
    state.sessions[str(issue_num)] = session
    state.save()

    ok = launch_agent(wt, session, resume=False, prompt_filename=".agent/prompt.md")
    if ok:
        session.status = "processing"
        set_labels(session, add=["processing"])
        upsert_status_comment(owner, repo, session, build_status_text(session))
        logger.info(f"Agent started for issue #{issue_num}")
    else:
        finalize_failed(session, owner, repo, "Failed to start agent in tmux.")
    state.save()
    return session


# ─── Terminal-state handlers ───────────────────────────────────


def finalize_done(session: Session, owner: str, repo: str) -> None:
    wt = session.worktree_path
    base = get_default_branch()
    summary = read_marker(wt, "done.md")
    commits = _safe(lambda: git("log", f"{base}..HEAD", "--oneline", cwd=wt), "")
    diffstat = _safe(lambda: git("diff", "--stat", f"{base}...HEAD", cwd=wt), "")
    _safe(lambda: run_cmd(["git", "push"], cwd=wt, check=False, env=ssh_env()))

    body = "✅ **Agent finished**\n\n"
    if summary:
        body += f"{summary}\n\n"
    if commits:
        body += f"**Commits:**\n```\n{commits}\n```\n\n"
    if diffstat:
        body += f"**Changes:**\n```\n{diffstat}\n```"
    _safe(lambda: post_comment(owner, repo, session.pr_number, body))

    set_labels(session, add=["done"], remove=["processing", "waiting"])
    session.status = "done"
    session.finished_at = datetime.now().isoformat()
    upsert_status_comment(owner, repo, session,
                          "## 🤖 AI Agent Status\n\n**State:** ✅ Completed\n\nSee the final comment for the summary.")


def finalize_failed(session: Session, owner: str, repo: str, reason: str) -> None:
    _safe(lambda: post_comment(owner, repo, session.pr_number, f"❌ **Agent failed**\n\n{reason}"))
    set_labels(session, add=["failed"], remove=["processing", "waiting"])
    session.status = "failed"
    session.error = reason
    session.finished_at = datetime.now().isoformat()
    upsert_status_comment(owner, repo, session,
                          f"## 🤖 AI Agent Status\n\n**State:** ❌ Failed\n\n{reason}")


def enter_waiting(session: Session, owner: str, repo: str) -> None:
    wt = session.worktree_path
    q = read_marker(wt, "clarification.md")
    cid = _safe(lambda: post_comment(
        owner, repo, session.pr_number,
        f"❓ **Clarification needed**\n\n> {q}\n\n"
        "Reply to this thread — the agent will resume automatically."))
    if cid:
        session.clarification_comment_id = cid
        # Comment ids are monotonic; our just-posted question is the newest,
        # so any later human reply has id > cid.
        session.last_seen_comment_id = cid
    set_labels(session, add=["waiting"], remove=["processing"])
    session.status = "waiting_clarification"
    upsert_status_comment(owner, repo, session, build_status_text(session))


def classify_end(session: Session, owner: str, repo: str) -> None:
    """Decide how a just-ended run finished, based on the marker files."""
    wt = session.worktree_path
    if marker_exists(wt, "done.md"):
        finalize_done(session, owner, repo)
    elif marker_exists(wt, "clarification.md"):
        enter_waiting(session, owner, repo)
    elif marker_exists(wt, "error.md"):
        finalize_failed(session, owner, repo, read_marker(wt, "error.md") or "Agent reported an error.")
    else:
        finalize_failed(session, owner, repo,
                        "Agent ended without writing a result marker (done/clarification/error).")


def find_new_human_reply(session: Session, owner: str, repo: str) -> Optional[str]:
    comments = _safe(lambda: get_comments(owner, repo, session.pr_number), [])
    new = [c for c in comments if isinstance(c, dict)
           and c.get("id", 0) > session.last_seen_comment_id
           and c.get("user", {}).get("login") != BOT_LOGIN]
    if new:
        new.sort(key=lambda c: c.get("id", 0))
        return new[0].get("body", "")
    return None


def resume_with_answer(session: Session, owner: str, repo: str, answer: str) -> None:
    wt = session.worktree_path
    agent_dir = Path(wt) / ".agent"
    q = read_marker(wt, "clarification.md")
    reply = (
        "A human answered your clarification question.\n\n"
        f"Question:\n{q}\n\n"
        f"Answer:\n{answer}\n\n"
        "Continue the task. When complete, follow the rules (commit, push, write .agent/done.md). "
        "If you still need clarification, write .agent/clarification.md again."
    )
    write_file(agent_dir / "reply.md", reply)
    (agent_dir / "clarification.md").unlink(missing_ok=True)

    ok = launch_agent(wt, session, resume=True, prompt_filename=".agent/reply.md")
    if ok:
        set_labels(session, add=["processing"], remove=["waiting"])
        session.status = "processing"
        session.started_at = datetime.now().isoformat()
        session.last_activity = datetime.now().isoformat()
        session.error = None
        _safe(lambda: post_comment(owner, repo, session.pr_number, "▶️ **Resumed** with your answer."))
        upsert_status_comment(owner, repo, session, build_status_text(session))
    else:
        finalize_failed(session, owner, repo, "Failed to restart agent after clarification.")


def relaunch(session: Session, owner: str, repo: str, resume: bool,
             prompt_filename: str, message: str) -> bool:
    kill_tmux(session.repo_name, session.issue_number)
    ok = launch_agent(session.worktree_path, session, resume=resume, prompt_filename=prompt_filename)
    _safe(lambda: post_comment(owner, repo, session.pr_number, message if ok else "❌ Failed to restart agent."))
    if ok:
        set_labels(session, add=["processing"], remove=["waiting", "failed", "done"])
        session.status = "processing"
        session.started_at = datetime.now().isoformat()
        session.last_activity = datetime.now().isoformat()
        session.error = None
        upsert_status_comment(owner, repo, session, build_status_text(session))
    return ok


# ─── Reconciliation (lifecycle driver) ─────────────────────────


def reconcile_sessions(state: AgentState, owner: str, repo: str) -> None:
    """Detect completed/ended runs, handle waiting-for-clarification, timeouts."""
    now = datetime.now()
    for sid, session in list(state.sessions.items()):
        try:
            if session.status == "processing":
                if not tmux_running(repo, session.issue_number):
                    classify_end(session, owner, repo)
                else:
                    started = parse_iso(session.started_at)
                    if started and (now - started) > timedelta(minutes=CONFIG["max_runtime_minutes"]):
                        kill_tmux(repo, session.issue_number)
                        finalize_failed(session, owner, repo,
                                        f"Timed out after {CONFIG['max_runtime_minutes']} minutes.")
            elif session.status == "waiting_clarification":
                answer = find_new_human_reply(session, owner, repo)
                if answer:
                    resume_with_answer(session, owner, repo, answer)
            elif session.status in ("done", "failed"):
                grace_h = CONFIG["auto_cleanup_grace_hours"]
                fin = parse_iso(session.finished_at) if session.finished_at else None
                if grace_h > 0 and fin and (now - fin) > timedelta(hours=grace_h):
                    cleanup_session(session)
                    del state.sessions[sid]
        except Exception as e:  # noqa: BLE001
            logger.error(f"Reconcile error for issue #{session.issue_number}: {e}", exc_info=True)
    state.save()


# ─── Cleanup ───────────────────────────────────────────────────


def cleanup_session(session: Session) -> None:
    n = session.issue_number
    branch = session.branch_name or f"issue-{n}"
    kill_tmux(session.repo_name, n)
    # Remove worktree first — git won't delete a branch that's checked out in a worktree.
    wt = Path(session.worktree_path)
    if wt.exists():
        _safe(lambda: git("worktree", "remove", str(wt), "--force"))
        if wt.exists():
            _safe(lambda: git("worktree", "prune"))
            if wt.exists():
                _safe(lambda: shutil.rmtree(str(wt)))
    _safe(lambda: git("branch", "-D", branch))
    _safe(lambda: run_cmd(["git", "push", get_remote(), "--delete", branch], check=False, env=ssh_env()))
    logger.info(f"Cleaned up session for issue #{n}")


# ─── PR command handling ───────────────────────────────────────


def parse_commands(text: str) -> list:
    """Parse /retry /continue /stop /debug anchored to the start of a line."""
    commands = []
    for line in (text or "").splitlines():
        m = re.match(r"^\s*/(retry|continue|stop|debug)\b\s*(.*)$", line)
        if m:
            commands.append({"command": m.group(1), "args": m.group(2).strip()})
    return commands


def extract_issue_from_pr(pr_num: int, owner: str, repo: str) -> Optional[int]:
    for pr in _safe(lambda: get_open_prs(owner, repo), []):
        if isinstance(pr, dict) and pr.get("number") == pr_num:
            ref = pr.get("head", {}).get("ref", "")
            m = re.search(r"issue-(\d+)", ref)
            if m:
                return int(m.group(1))
            m = re.search(r"closes\s+#(\d+)", pr.get("body", "") or "")
            if m:
                return int(m.group(1))
    return None


def _bootstrap_retry_session(issue_num: int, pr_num: int, owner: str, repo: str,
                             args: str, state: AgentState) -> Optional[Session]:
    """Bootstrap a new session for /retry when no active session exists."""
    # Fetch issue details
    issue_data = _safe(lambda: fj_get(f"/repos/{owner}/{repo}/issues/{issue_num}"), {})
    if not issue_data:
        logger.warning(f"Could not fetch issue #{issue_num} for retry bootstrap")
        return None
    title = issue_data.get("title", f"Issue #{issue_num}")
    body = issue_data.get("body", "") or ""

    # Create/reuse worktree
    base = get_default_branch()
    wt, branch = create_worktree(issue_num, repo, base)

    # Install deps if needed
    if (Path(wt) / "pnpm-lock.yaml").exists():
        _safe(lambda: install_dependencies(wt))

    # Ensure agent dir
    ensure_agent_dir(wt)

    # Build prompt with retry context
    comments = _safe(lambda: get_comments(owner, repo, pr_num), [])
    ctext = "\n---\n".join(c.get("body", "") for c in comments if c.get("body"))
    task = f"Title: {title}\n\nBody:\n{body}"
    prompt = (PREAMBLE + "\n---\n\n## TASK\n" + task
              + f"\n\n## RETRY\nA previous attempt did not finish. Recent PR comments:\n{ctext}")
    if args:
        prompt += f"\n\nAdditional instruction: {args}"
    write_file(Path(wt) / ".agent" / "prompt.md", prompt)

    # Create session
    session = Session(
        issue_number=issue_num,
        pr_number=pr_num,
        branch_name=branch,
        worktree_path=wt,
        status="processing",
        started_at=datetime.now().isoformat(),
        last_activity=datetime.now().isoformat(),
        agent_prompt=task,
        repo_owner=owner,
        repo_name=repo,
    )
    state.sessions[str(issue_num)] = session
    state.save()

    # Launch agent
    ok = launch_agent(wt, session, resume=False, prompt_filename=".agent/prompt.md")
    if ok:
        set_labels(session, add=["processing"], remove=["failed", "done"])
        upsert_status_comment(owner, repo, session, build_status_text(session))
        logger.info(f"Bootstrapped new session for issue #{issue_num} via /retry")
        return session
    else:
        finalize_failed(session, owner, repo, "Failed to start agent in tmux.")
        return None


def retry_issue(issue_num: int, owner: str, repo: str, state: AgentState,
                args: str = "") -> None:
    """Run the retry flow for an issue: relaunch existing session or bootstrap a new one."""
    sid = str(issue_num)

    if sid in state.sessions:
        # Existing session — relaunch with retry prompt
        session = state.sessions[sid]
        wt = session.worktree_path
        ensure_agent_dir(wt)
        comments = _safe(lambda: get_comments(owner, repo, session.pr_number), [])
        ctext = "\n---\n".join(c.get("body", "") for c in comments if c.get("body"))
        prompt = (PREAMBLE + "\n---\n\n## TASK\n" + session.agent_prompt
                  + f"\n\n## RETRY\nA previous attempt did not finish. Recent PR comments:\n{ctext}")
        if args:
            prompt += f"\n\nAdditional instruction: {args}"
        write_file(Path(wt) / ".agent" / "prompt.md", prompt)
        relaunch(session, owner, repo, resume=False, prompt_filename=".agent/prompt.md",
                 message="🔄 **Retry started**.")
        state.save()
        return

    # No session — bootstrap a new one
    issue_data = _safe(lambda: fj_get(f"/repos/{owner}/{repo}/issues/{issue_num}"), {})
    if not issue_data:
        logger.warning(f"Could not fetch issue #{issue_num} for retry")
        return
    title = issue_data.get("title", f"Issue #{issue_num}")
    body = issue_data.get("body", "") or ""

    base = get_default_branch()
    wt, branch = create_worktree(issue_num, repo, base)

    if (Path(wt) / "pnpm-lock.yaml").exists():
        _safe(lambda: install_dependencies(wt))

    ensure_agent_dir(wt)

    # Find or create PR
    pr_num = find_existing_pr(branch, owner, repo)
    if pr_num is None:
        try:
            pr_num = create_pr(owner, repo, f"WIP: {title}", f"{body}\n\ncloses #{issue_num}",
                               branch, base, wt)
        except Exception as e:
            logger.error(f"Failed to create PR for issue #{issue_num}: {e}")
            return

    # Build prompt with retry context from PR comments
    comments = _safe(lambda: get_comments(owner, repo, pr_num), [])
    ctext = "\n---\n".join(c.get("body", "") for c in comments if c.get("body"))
    task = f"Title: {title}\n\nBody:\n{body}"
    prompt = (PREAMBLE + "\n---\n\n## TASK\n" + task
              + f"\n\n## RETRY\nA previous attempt did not finish. Recent PR comments:\n{ctext}")
    if args:
        prompt += f"\n\nAdditional instruction: {args}"
    write_file(Path(wt) / ".agent" / "prompt.md", prompt)

    session = Session(
        issue_number=issue_num,
        pr_number=pr_num,
        branch_name=branch,
        worktree_path=wt,
        status="processing",
        started_at=datetime.now().isoformat(),
        last_activity=datetime.now().isoformat(),
        agent_prompt=task,
        repo_owner=owner,
        repo_name=repo,
    )
    state.sessions[str(issue_num)] = session
    state.save()

    ok = launch_agent(wt, session, resume=False, prompt_filename=".agent/prompt.md")
    if ok:
        set_labels(session, add=["processing"], remove=["failed", "done"])
        upsert_status_comment(owner, repo, session, build_status_text(session))
        logger.info(f"Started retry for issue #{issue_num}")
    else:
        finalize_failed(session, owner, repo, "Failed to start agent in tmux.")
    state.save()


def handle_pr_command(pr_num: int, command: str, args: str, state: AgentState,
                      owner: str, repo: str) -> None:
    logger.info(f"PR #{pr_num}: handling /{command} {args}")
    issue_num = extract_issue_from_pr(pr_num, owner, repo)
    if not issue_num:
        _safe(lambda: post_comment(owner, repo, pr_num, "❌ Could not determine the associated issue."))
        return
    sid = str(issue_num)
    if sid not in state.sessions:
        if command == "retry":
            session = _bootstrap_retry_session(issue_num, pr_num, owner, repo, args, state)
            if session:
                _safe(lambda: post_comment(owner, repo, pr_num, "🔄 **Retry started** — created a new session."))
                return
        _safe(lambda: post_comment(owner, repo, pr_num, f"❌ No active session for issue #{issue_num}."))
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
            _safe(lambda: post_comment(owner, repo, pr_num, "🛑 Stopped by user."))
            upsert_status_comment(owner, repo, session, "## 🤖 AI Agent Status\n\n**State:** 🛑 Stopped")

        elif command == "retry":
            comments = _safe(lambda: get_comments(owner, repo, pr_num), [])
            ctext = "\n---\n".join(c.get("body", "") for c in comments if c.get("body"))
            prompt = (PREAMBLE + "\n---\n\n## TASK\n" + session.agent_prompt
                      + f"\n\n## RETRY\nA previous attempt did not finish. Recent PR comments:\n{ctext}")
            if args:
                prompt += f"\n\nAdditional instruction: {args}"
            write_file(Path(wt) / ".agent" / "prompt.md", prompt)
            relaunch(session, owner, repo, resume=False, prompt_filename=".agent/prompt.md",
                     message="🔄 **Retry started** with comment context.")

        elif command == "continue":
            reply = "CONTINUE: Continue from where you left off." + (f" Context: {args}" if args else "")
            write_file(Path(wt) / ".agent" / "reply.md", reply)
            relaunch(session, owner, repo, resume=True, prompt_filename=".agent/reply.md",
                     message="▶️ **Continued**.")

        elif command == "debug":
            reply = "DEBUG: Investigate the current state in detail and be verbose." + (
                f" Focus: {args}" if args else "")
            write_file(Path(wt) / ".agent" / "reply.md", reply)
            relaunch(session, owner, repo, resume=True, prompt_filename=".agent/reply.md",
                     message="🔍 **Debug session** started.")

        state.save()
    except Exception as e:  # noqa: BLE001
        logger.error(f"Error handling /{command} on PR #{pr_num}: {e}", exc_info=True)
        _safe(lambda: post_comment(owner, repo, pr_num, f"❌ Error: {e}"))


def prune_state(state: AgentState) -> None:
    limit = CONFIG["max_processed_comments"]
    if len(state.processed_comments) > limit:
        items = sorted(state.processed_comments.items(), key=lambda kv: kv[1])
        for k, _ in items[: len(items) - limit]:
            del state.processed_comments[k]


def check_pr_commands(state: AgentState, owner: str, repo: str) -> None:
    for pr in _safe(lambda: get_open_prs(owner, repo), []):
        pr_num = pr.get("number") if isinstance(pr, dict) else None
        if not pr_num:
            continue
        for c in _safe(lambda: get_comments(owner, repo, pr_num), []):
            if not isinstance(c, dict):
                continue
            cid = c.get("id", 0)
            body = c.get("body", "") or ""
            if c.get("user", {}).get("login") == BOT_LOGIN:
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


# ─── New-issue polling ─────────────────────────────────────────


def check_new_issues(state: AgentState, owner: str, repo: str) -> None:
    for issue in _safe(lambda: get_assigned_issues(owner, repo), []):
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
        except Exception as e:  # noqa: BLE001
            logger.error(f"Error processing issue #{n}: {e}", exc_info=True)
            _safe(lambda: post_comment(owner, repo, n, f"❌ Failed to start: {e}"))
            _safe(lambda: add_labels(owner, repo, n, [CONFIG["failed_label"]]))
    state.last_issue_check = datetime.now().isoformat()
    state.save()


# ─── Daemon loop ───────────────────────────────────────────────


def run_daemon(interval: int) -> None:
    global BOT_LOGIN
    owner, repo, _ = get_repo_info()
    logger.info(f"Repository: {owner}/{repo}")
    BOT_LOGIN = validate_token()

    state = AgentState.load()
    logger.info(f"Loaded state: {len(state.sessions)} sessions")

    running = True

    def handler(sig, frame):  # noqa: ANN001
        nonlocal running
        logger.info("Shutdown signal received; stopping...")
        running = False

    signal.signal(signal.SIGINT, handler)
    signal.signal(signal.SIGTERM, handler)

    iteration = 0
    while running:
        iteration += 1
        #logger.info(f"--- Poll iteration #{iteration} ---")
        try:
            kill_orphaned_sessions(state, repo)
            reconcile_sessions(state, owner, repo)
            check_new_issues(state, owner, repo)
            check_pr_commands(state, owner, repo)
        except Exception as e:  # noqa: BLE001
            logger.error(f"Error in poll loop: {e}", exc_info=True)
        #logger.info(f"Sleeping for {interval}s...")
        for _ in range(interval):
            if not running:
                break
            time.sleep(1)
    logger.info("Daemon stopped.")


# ─── CLI ───────────────────────────────────────────────────────


def main() -> None:
    global BOT_LOGIN
    parser = argparse.ArgumentParser(description="Forgejo AI Agent Daemon (hardened)")
    parser.add_argument("command", choices=["daemon", "pick", "status", "cleanup", "check", "clean", "pending"])
    parser.add_argument("--interval", type=int, default=CONFIG["poll_interval"])
    parser.add_argument("--issue", type=int, help="Issue number for 'clean'")
    args = parser.parse_args()

    owner = repo = None
    if args.command not in ("status",):
        try:
            owner, repo, _ = get_repo_info()
        except Exception as e:  # noqa: BLE001
            print(f"Error: {e}")
            sys.exit(1)

    if args.command == "daemon":
        run_daemon(args.interval)

    elif args.command == "pick":
        BOT_LOGIN = validate_token()
        state = AgentState.load()
        issues = _safe(lambda: get_assigned_issues(owner, repo), [])
        if not issues:
            print("No open issues assigned to the agent.")
            return
        issue = issues[0]
        print(f"Picking issue #{issue['number']}: {issue.get('title','')}")
        process_new_issue(issue, state, owner, repo)

    elif args.command == "status":
        state = AgentState.load()
        icons = {"processing": "🟢", "waiting_clarification": "⏸️", "done": "✅", "failed": "❌"}
        print(f"\n📊 Sessions: {len(state.sessions)}")
        for _, s in state.sessions.items():
            rname = s.repo_name
            running = tmux_running(rname, s.issue_number) if rname else False
            icon = icons.get(s.status, "•")
            win = _win_for_issue(rname, s.issue_number) if rname else ""
            extra = f" (tmux: {TMUX_SESSION}:{win})" if running else ""
            print(f"  {icon} #{s.issue_number} [{s.status}] PR#{s.pr_number}{extra}")
            if s.error:
                print(f"      error: {s.error}")
        # All sessions in one state file belong to a single repo; derive it to
        # enumerate live windows (lets `status` run without a git checkout).
        repo = next((s.repo_name for s in state.sessions.values() if s.repo_name), None)
        if repo:
            tracked = {s.issue_number for s in state.sessions.values()}
            live = list_agent_windows(repo)
            orphans = [n for n in live if n not in tracked]
            print(f"\nLive agent sessions: {len(live)} / {CONFIG['max_concurrent_sessions']}")
            if orphans:
                print(f"  ⚠️  Orphaned (not in state): {orphans} — will be killed on next poll")
        else:
            print("\nLive agent sessions: n/a (no sessions)")
        print(f"Processed comments: {len(state.processed_comments)}")
        print(f"Last issue check: {state.last_issue_check}")
        print(f"Last PR check: {state.last_pr_check}")

    elif args.command == "cleanup":
        state = AgentState.load()
        for sid, s in list(state.sessions.items()):
            if s.status in ("done", "failed"):
                cleanup_session(s)
                del state.sessions[sid]
        state.save()
        print("✅ Cleanup complete.")

    elif args.command == "check":
        BOT_LOGIN = validate_token()
        state = AgentState.load()
        kill_orphaned_sessions(state, repo)
        reconcile_sessions(state, owner, repo)
        check_new_issues(state, owner, repo)
        check_pr_commands(state, owner, repo)
        print("✅ Check complete.")

    elif args.command == "clean":
        if not args.issue:
            print("Error: --issue <number> is required for 'clean'")
            sys.exit(1)
        state = AgentState.load()
        sid = str(args.issue)
        if sid in state.sessions:
            cleanup_session(state.sessions[sid])
            del state.sessions[sid]
            state.save()
        else:
            branch = f"issue-{args.issue}"
            wt = Path(CONFIG["worktree_base"]) / f"{repo}-{args.issue}"
            kill_tmux(repo, args.issue)
            _safe(lambda: git("branch", "-D", branch))
            _safe(lambda: run_cmd(["git", "push", get_remote(), "--delete", branch], check=False, env=ssh_env()))
            if wt.exists():
                _safe(lambda: git("worktree", "remove", str(wt), "--force"))
                if wt.exists():
                    _safe(lambda: shutil.rmtree(str(wt)))
        print(f"✅ Cleaned up issue #{args.issue}")

    elif args.command == "pending":
        BOT_LOGIN = validate_token()
        state = AgentState.load()

        # 1) List unprocessed issues
        issues = _safe(lambda: get_assigned_issues(owner, repo), [])
        pending = [i for i in issues
                   if isinstance(i, dict) and str(i.get("number")) not in state.sessions]
        if pending:
            print(f"\n📋 Pending issues (assigned to '{CONFIG['assignee']}', not yet processed): {len(pending)}\n")
            for issue in pending:
                num = issue["number"]
                title = issue.get("title", "")
                labels = [l["name"] for l in issue.get("labels", []) if isinstance(l, dict)]
                label_str = f" [{', '.join(labels)}]" if labels else ""
                print(f"  #{num} {title}{label_str}")

        # 2) Check open PRs for unprocessed /retry commands
        print()
        retry_found = []
        for pr in _safe(lambda: get_open_prs(owner, repo), []):
            pr_num = pr.get("number") if isinstance(pr, dict) else None
            if not pr_num:
                continue
            for c in _safe(lambda: get_comments(owner, repo, pr_num), []):
                if not isinstance(c, dict):
                    continue
                cid = c.get("id", 0)
                body = c.get("body", "") or ""
                if c.get("user", {}).get("login") == BOT_LOGIN:
                    continue
                cmd_id = f"pr-{pr_num}-c-{cid}"
                if cmd_id in state.processed_comments:
                    continue
                commands = parse_commands(body)
                if not commands:
                    continue
                for cmd in commands:
                    if cmd["command"] == "retry":
                        retry_found.append((pr_num, cmd_id, cmd["args"]))
                        # Mark as processed so we don't re-trigger
                        state.processed_comments[cmd_id] = datetime.now().isoformat()
                        break

        if retry_found:
            print(f"🔄 Unprocessed /retry commands in PRs: {len(retry_found)}\n")
            for pr_num, cmd_id, retry_args in retry_found:
                issue_num = extract_issue_from_pr(pr_num, owner, repo)
                if not issue_num:
                    print(f"  ⚠️  PR #{pr_num}: could not determine associated issue")
                    continue
                print(f"  Retrying issue #{issue_num} (from PR #{pr_num})")
                try:
                    retry_issue(issue_num, owner, repo, state, args=retry_args)
                except Exception as e:
                    logger.error(f"Error retrying issue #{issue_num}: {e}", exc_info=True)
                    print(f"    ❌ Failed: {e}")
            print("\n✅ Retry complete.")
        else:
            print("No unprocessed /retry commands in PRs.")

        state.save()


if __name__ == "__main__":
    main()
