"""Core lifecycle: issue processing, terminal states, reconciliation, cleanup.

Contains the deduplicated retry logic — `retry_issue` is the single entry point
for all retry flows (used by both the /retry PR command and the `pending` CLI).
"""

import logging
import shutil
from datetime import datetime, timedelta
from pathlib import Path

import config
from config import CONFIG, PREAMBLE
from models import Session, AgentState
from utils import safe, parse_iso, write_file
from git_ops import git, run_cmd, ssh_env, get_remote, get_default_branch
from forgejo_api import get_comments, post_comment
from forgejo_client import ForgejoError, fj_get
from markers import ensure_agent_dir, marker_exists, read_marker
from tmux_manager import (
    launch_agent, kill_tmux, tmux_running,
)
from worktree import create_worktree, install_dependencies, create_pr, find_existing_pr
from status import set_labels, upsert_status_comment, build_status_text

logger = logging.getLogger(__name__)


# ─── Shared helpers ────────────────────────────────────────────


def _build_retry_prompt(task: str, comments_text: str, args: str = "") -> str:
    """Build a retry prompt with PR comment context."""
    prompt = (PREAMBLE + "\n---\n\n## TASK\n" + task
              + f"\n\n## RETRY\nA previous attempt did not finish. Recent PR comments:\n{comments_text}")
    if args:
        prompt += f"\n\nAdditional instruction: {args}"
    return prompt


def _gather_comments_text(owner: str, repo: str, pr_num: int) -> str:
    """Collect PR comment bodies joined by separators."""
    comments = safe(lambda: get_comments(owner, repo, pr_num), [])
    return "\n---\n".join(c.get("body", "") for c in comments if c.get("body"))


def _setup_worktree(issue_num: int, owner: str, repo: str) -> tuple:
    """Create/reuse worktree, install deps if needed. Returns (wt, branch, base)."""
    base = get_default_branch()
    wt, branch = create_worktree(issue_num, repo, base)
    if (Path(wt) / "pnpm-lock.yaml").exists():
        safe(lambda: install_dependencies(wt))
    ensure_agent_dir(wt)
    return wt, branch, base


def _ensure_pr(issue_num: int, title: str, body: str, branch: str, base: str,
               wt: str, owner: str, repo: str) -> int:
    """Find existing PR or create a new one. Returns PR number."""
    pr_num = find_existing_pr(branch, owner, repo)
    if pr_num is None:
        pr_num = create_pr(owner, repo, f"WIP: {title}", f"{body}\n\ncloses #{issue_num}",
                           branch, base, wt)
    return pr_num


def ensure_worktree(session: Session) -> str:
    """Ensure the session's worktree is a valid git worktree; return its path.

    Reuses an existing valid worktree, or recreates one if the stored path is
    missing or corrupt (e.g. after a crashed run). Keeps session.worktree_path
    in sync so every downstream git op runs in a real working tree. Idempotent.
    """
    base = get_default_branch()
    wt, _branch = create_worktree(session.issue_number, session.repo_name, base)
    session.worktree_path = wt
    return wt


# ─── New issue processing ──────────────────────────────────────


def process_new_issue(issue: dict, state: AgentState, owner: str, repo: str) -> Session | None:
    issue_num = issue["number"]
    title = issue.get("title", "")
    body = issue.get("body", "") or ""
    logger.info(f"Processing issue #{issue_num}: {title}")

    wt, branch, base = _setup_worktree(issue_num, owner, repo)

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
    task = f"Title: {title}\n\nBody:\n{body}"
    write_file(f"{wt}/.agent/prompt.md", PREAMBLE + "\n---\n\n## TASK\n" + task)

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


# ─── Retry (deduplicated) ──────────────────────────────────────


def retry_issue(issue_num: int, owner: str, repo: str, state: AgentState,
                args: str = "", pr_num: int | None = None) -> None:
    """Single entry point for all retry flows.

    Handles both cases:
      - Existing session: relaunch with retry prompt + comment context
      - No session: bootstrap a new one (worktree, PR, prompt, launch)
    """
    sid = str(issue_num)

    if sid in state.sessions:
        # Existing session — relaunch with retry prompt
        session = state.sessions[sid]
        wt = ensure_worktree(session)  # recover if the worktree is missing/corrupt
        ensure_agent_dir(wt)
        ctext = _gather_comments_text(owner, repo, session.pr_number)
        prompt = _build_retry_prompt(session.agent_prompt, ctext, args)
        write_file(f"{wt}/.agent/prompt.md", prompt)
        relaunch(session, owner, repo, resume=False, prompt_filename=".agent/prompt.md",
                 message="🔄 **Retry started**.")
        state.save()
        return

    # No session — bootstrap a new one
    issue_data = safe(lambda: fj_get(f"/repos/{owner}/{repo}/issues/{issue_num}"), {})
    if not issue_data:
        logger.warning(f"Could not fetch issue #{issue_num} for retry")
        return
    title = issue_data.get("title", f"Issue #{issue_num}")
    body = issue_data.get("body", "") or ""

    wt, branch, base = _setup_worktree(issue_num, owner, repo)

    # Find or create PR
    if pr_num is None:
        pr_num = _ensure_pr(issue_num, title, body, branch, base, wt, owner, repo)

    # Build prompt with retry context from PR comments
    ctext = _gather_comments_text(owner, repo, pr_num)
    task = f"Title: {title}\n\nBody:\n{body}"
    prompt = _build_retry_prompt(task, ctext, args)
    write_file(f"{wt}/.agent/prompt.md", prompt)

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
    state.sessions[sid] = session
    state.save()

    ok = launch_agent(wt, session, resume=False, prompt_filename=".agent/prompt.md")
    if ok:
        set_labels(session, add=["processing"], remove=["failed", "done"])
        upsert_status_comment(owner, repo, session, build_status_text(session))
        logger.info(f"Started retry for issue #{issue_num}")
    else:
        finalize_failed(session, owner, repo, "Failed to start agent in tmux.")
    state.save()


# ─── Terminal-state handlers ───────────────────────────────────


def finalize_done(session: Session, owner: str, repo: str) -> None:
    wt = session.worktree_path
    base = get_default_branch()
    summary = read_marker(wt, "done.md")
    commits = safe(lambda: git("log", f"{base}..HEAD", "--oneline", cwd=wt), "")
    diffstat = safe(lambda: git("diff", "--stat", f"{base}...HEAD", cwd=wt), "")
    safe(lambda: run_cmd(["git", "push"], cwd=wt, check=False, env=ssh_env()))

    body = "✅ **Agent finished**\n\n"
    if summary:
        body += f"{summary}\n\n"
    if commits:
        body += f"**Commits:**\n```\n{commits}\n```\n\n"
    if diffstat:
        body += f"**Changes:**\n```\n{diffstat}\n```"
    safe(lambda: post_comment(owner, repo, session.pr_number, body))

    set_labels(session, add=["done"], remove=["processing", "waiting"])
    session.status = "done"
    session.finished_at = datetime.now().isoformat()
    upsert_status_comment(owner, repo, session,
                          "## 🤖 AI Agent Status\n\n**State:** ✅ Completed\n\nSee the final comment for the summary.")


def finalize_failed(session: Session, owner: str, repo: str, reason: str) -> None:
    safe(lambda: post_comment(owner, repo, session.pr_number, f"❌ **Agent failed**\n\n{reason}"))
    set_labels(session, add=["failed"], remove=["processing", "waiting"])
    session.status = "failed"
    session.error = reason
    session.finished_at = datetime.now().isoformat()
    upsert_status_comment(owner, repo, session,
                          f"## 🤖 AI Agent Status\n\n**State:** ❌ Failed\n\n{reason}")


def enter_waiting(session: Session, owner: str, repo: str) -> None:
    wt = session.worktree_path
    q = read_marker(wt, "clarification.md")
    cid = safe(lambda: post_comment(
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


# ─── Clarification / resume ────────────────────────────────────


def find_new_human_reply(session: Session, owner: str, repo: str) -> str | None:
    comments = safe(lambda: get_comments(owner, repo, session.pr_number), [])
    new = [c for c in comments if isinstance(c, dict)
           and c.get("id", 0) > session.last_seen_comment_id
           and c.get("user", {}).get("login") != config.BOT_LOGIN]
    if new:
        new.sort(key=lambda c: c.get("id", 0))
        return new[0].get("body", "")
    return None


def resume_with_answer(session: Session, owner: str, repo: str, answer: str) -> None:
    wt = ensure_worktree(session)
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
        safe(lambda: post_comment(owner, repo, session.pr_number, "▶️ **Resumed** with your answer."))
        upsert_status_comment(owner, repo, session, build_status_text(session))
    else:
        finalize_failed(session, owner, repo, "Failed to restart agent after clarification.")


# ─── Relaunch ──────────────────────────────────────────────────


def relaunch(session: Session, owner: str, repo: str, resume: bool,
             prompt_filename: str, message: str) -> bool:
    ensure_worktree(session)
    kill_tmux(session.repo_name, session.issue_number)
    ok = launch_agent(session.worktree_path, session, resume=resume, prompt_filename=prompt_filename)
    safe(lambda: post_comment(owner, repo, session.pr_number, message if ok else "❌ Failed to restart agent."))
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
        except Exception as e:
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
        safe(lambda: git("worktree", "remove", str(wt), "--force"))
        if wt.exists():
            safe(lambda: git("worktree", "prune"))
            if wt.exists():
                safe(lambda: shutil.rmtree(str(wt)))
    safe(lambda: git("branch", "-D", branch))
    safe(lambda: run_cmd(["git", "push", get_remote(), "--delete", branch], check=False, env=ssh_env()))
    logger.info(f"Cleaned up session for issue #{n}")
