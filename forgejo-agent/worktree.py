"""Worktree and PR creation."""

import logging
from pathlib import Path
from typing import Optional

from config import CONFIG
from git_ops import git, run_cmd, ssh_env, get_remote
from forgejo_api import get_open_prs
from forgejo_client import fj_post
from utils import safe

logger = logging.getLogger(__name__)


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
    for pr in safe(lambda: get_open_prs(owner, repo), []):
        if isinstance(pr, dict) and pr.get("head", {}).get("ref") == branch_name:
            return pr.get("number")
    return None
