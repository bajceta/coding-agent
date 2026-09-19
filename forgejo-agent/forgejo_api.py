"""High-level Forgejo API operations (issues, comments, PRs, labels)."""

import re
import logging
from typing import Optional

from config import CONFIG
from forgejo_client import fj_get, fj_post, fj_patch, fj_delete
from utils import safe

logger = logging.getLogger(__name__)


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


def extract_issue_from_pr(pr_num: int, owner: str, repo: str) -> Optional[int]:
    """Find the issue number associated with a PR (via branch name or body)."""
    for pr in safe(lambda: get_open_prs(owner, repo), []):
        if isinstance(pr, dict) and pr.get("number") == pr_num:
            ref = pr.get("head", {}).get("ref", "")
            m = re.search(r"issue-(\d+)", ref)
            if m:
                return int(m.group(1))
            m = re.search(r"closes\s+#(\d+)", pr.get("body", "") or "")
            if m:
                return int(m.group(1))
    return None
