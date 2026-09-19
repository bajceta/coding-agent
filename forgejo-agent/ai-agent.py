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

import sys
import argparse
from datetime import datetime
from pathlib import Path

import config
from config import CONFIG
from models import AgentState
from git_ops import get_repo_info, git, run_cmd, ssh_env, get_remote
from forgejo_client import validate_token
from forgejo_api import get_assigned_issues, get_open_prs, get_comments, extract_issue_from_pr
from tmux_manager import (
    TMUX_SESSION, _win_for_issue, tmux_running, kill_tmux, list_agent_windows,
    kill_orphaned_sessions,
)
from lifecycle import (
    process_new_issue, retry_issue, reconcile_sessions, cleanup_session,
)
from commands import check_pr_commands, parse_commands
from daemon import run_daemon, check_new_issues
from utils import safe


def main() -> None:
    parser = argparse.ArgumentParser(description="Forgejo AI Agent Daemon (hardened)")
    parser.add_argument("command", choices=["daemon", "pick", "status", "cleanup", "check", "clean", "pending"])
    parser.add_argument("--interval", type=int, default=CONFIG["poll_interval"])
    parser.add_argument("--issue", type=int, help="Issue number for 'clean'")
    args = parser.parse_args()

    owner = repo = None
    if args.command not in ("status",):
        try:
            owner, repo, _ = get_repo_info()
        except Exception as e:
            print(f"Error: {e}")
            sys.exit(1)

    if args.command == "daemon":
        run_daemon(args.interval)

    elif args.command == "pick":
        validate_token()
        state = AgentState.load()
        issues = safe(lambda: get_assigned_issues(owner, repo), [])
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
        validate_token()
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
            safe(lambda: git("branch", "-D", branch))
            safe(lambda: run_cmd(["git", "push", get_remote(), "--delete", branch], check=False, env=ssh_env()))
            if wt.exists():
                safe(lambda: git("worktree", "remove", str(wt), "--force"))
                if wt.exists():
                    import shutil
                    safe(lambda: shutil.rmtree(str(wt)))
        print(f"✅ Cleaned up issue #{args.issue}")

    elif args.command == "pending":
        validate_token()
        state = AgentState.load()

        # 1) List unprocessed issues
        issues = safe(lambda: get_assigned_issues(owner, repo), [])
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
                    retry_issue(issue_num, owner, repo, state, args=retry_args, pr_num=pr_num)
                except Exception as e:
                    print(f"    ❌ Failed: {e}")
            print("\n✅ Retry complete.")
        else:
            print("No unprocessed /retry commands in PRs.")

        state.save()


if __name__ == "__main__":
    main()
