"""Git operations: command wrappers, remote/branch detection, repo info."""

import os
import re
import subprocess
import logging
from typing import Optional

from config import FORGEJO, CONFIG
from utils import safe

logger = logging.getLogger(__name__)


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


# ─── Cached repo detection ─────────────────────────────────────

_remote_cache: Optional[str] = None
_default_branch_cache: Optional[str] = None


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
    except Exception:
        pass
    try:
        output = git("symbolic-ref", f"refs/remotes/{remote}/HEAD")
        _default_branch_cache = output.rsplit("/", 1)[-1]
        return _default_branch_cache
    except Exception:
        pass
    logger.warning("Could not detect default branch; falling back to 'main'")
    _default_branch_cache = "main"
    return _default_branch_cache


def get_repo_info() -> tuple:
    """Owner/repo from env (preferred) or the git remote; local path from git."""
    o = os.environ.get("FORGEJO_OWNER")
    r = os.environ.get("FORGEJO_REPO")
    if o and r:
        top = safe(lambda: git("rev-parse", "--show-toplevel"), os.getcwd())
        return o, r, top
    try:
        url = git("remote", "get-url", get_remote())
    except Exception as e:
        raise RuntimeError(
            "No suitable git remote and FORGEJO_OWNER/FORGEJO_REPO not set. "
            "Set the env vars or add a remote."
        ) from e
    m = re.search(r"[:/]([^/:]+)/([^/]+?)(?:\.git)?$", url)
    if not m:
        raise RuntimeError(f"Could not parse owner/repo from remote URL: {url}")
    top = safe(lambda: git("rev-parse", "--show-toplevel"), os.getcwd())
    return m.group(1), m.group(2), top
