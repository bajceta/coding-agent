#!/usr/bin/env python3
"""Offline tests for ai-agent.py (no network / token required)."""
import importlib.util
import os
import subprocess
import tempfile
from datetime import timedelta
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("ai_agent", HERE / "ai-agent.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

passed = 0
failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}")


print("== parse_commands (anchored, human-style) ==")
check("single /retry", mod.parse_commands("/retry") == [{"command": "retry", "args": ""}])
check("anchored only (inline ignored)", mod.parse_commands("hello /continue now") == [])
check("multi-line", mod.parse_commands("/continue do x\n/retry") == [
    {"command": "continue", "args": "do x"}, {"command": "retry", "args": ""}])
check("indented ok", mod.parse_commands("  /stop now") == [{"command": "stop", "args": "now"}])
check("unknown ignored", mod.parse_commands("/foo bar") == [])

print("== get_repo_info (env override) ==")
os.environ["FORGEJO_OWNER"] = "acme"
os.environ["FORGEJO_REPO"] = "widget"
o, r, _ = mod.get_repo_info()
check("env owner/repo", (o, r) == ("acme", "widget"))
del os.environ["FORGEJO_OWNER"]
del os.environ["FORGEJO_REPO"]

print("== repo URL parsing regex ==")
rx = r"[:/]([^/:]+)/([^/]+?)(?:\.git)?$"
import re
for url, exp in [
    ("ssh://git@forgejo.x/acme/widget.git", ("acme", "widget")),
    ("git@forgejo.x:acme/widget.git", ("acme", "widget")),
    ("https://forgejo.x/acme/widget.git", ("acme", "widget")),
]:
    m = re.search(rx, url)
    check(f"url {url}", bool(m) and (m.group(1), m.group(2)) == exp)

print("== sanitize / fmt_duration ==")
check("ansi stripped", mod.sanitize("\x1b[31mred\x1b[0m") == "red")
check("duration 90m", mod.fmt_duration(timedelta(minutes=90)) == "1h 30m")
check("duration 45s", mod.fmt_duration(timedelta(seconds=45)) == "45s")

print("== AgentState atomic save/load roundtrip ==")
with tempfile.TemporaryDirectory() as td:
    mod.STATE_FILE = Path(td) / "state.json"
    st = mod.AgentState()
    st.sessions["7"] = mod.Session(issue_number=7, pr_number=11, branch_name="issue-7",
                                   worktree_path="/tmp/wt", status="waiting_clarification",
                                   status_comment_id=99, last_seen_comment_id=500)
    st.processed_comments["pr-11-c-5"] = "2024-01-01T00:00:00"
    st.save()
    loaded = mod.AgentState.load()
    check("session restored", loaded.sessions["7"].status == "waiting_clarification")
    check("status_comment_id restored", loaded.sessions["7"].status_comment_id == 99)
    check("processed restored", loaded.processed_comments["pr-11-c-5"] == "2024-01-01T00:00:00")
    check("no leftover tmp", not (Path(td) / "state.tmp").exists())

print("== launch_agent command construction ==")
calls = []


def fake_run(cmd, *a, **k):
    calls.append(cmd)
    return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")


real_run = subprocess.run
subprocess.run = fake_run
try:
    with tempfile.TemporaryDirectory() as td:
        wt = td
        mod.ensure_agent_dir(wt)
        (Path(wt) / ".agent" / "prompt.md").write_text("task")
        sess = mod.Session(issue_number=42, worktree_path=wt)
        mod.launch_agent(wt, sess, resume=False, prompt_filename="prompt.md")
        new = [c for c in calls if c[:1] == ["tmux"] and "new-session" in c]
        shell = new[-1][-1]
        check("uses -f prompt.md", "-f prompt.md" in shell)
        check("uses --save", "--save .agent/session.json" in shell)
        check("uses --silent", "--silent" in shell)
        check("no --continue on first run", "--continue" not in shell)
        check("yolo run mode", "--mode run" in shell and "-y" in shell)

        # resume with existing session.json -> includes --continue
        (Path(wt) / ".agent" / "session.json").write_text("{}")
        calls.clear()
        mod.launch_agent(wt, sess, resume=True, prompt_filename="reply.md")
        shell = [c for c in calls if c[:1] == ["tmux"] and "new-session" in c][-1][-1]
        check("resume includes --continue", "--continue .agent/session.json" in shell)
finally:
    subprocess.run = real_run

print("== .agent is git-ignored ==")
with tempfile.TemporaryDirectory() as td:
    mod.ensure_agent_dir(td)
    gi = (Path(td) / ".agent" / ".gitignore").read_text().strip()
    check("gitignore content", gi == "*")

print("== classify_end marker logic ==")
real_finalize_done = mod.finalize_done
real_enter_waiting = mod.enter_waiting
real_finalize_failed = mod.finalize_failed
seen = []
mod.finalize_done = lambda *a: seen.append("done")
mod.enter_waiting = lambda *a: seen.append("waiting")
mod.finalize_failed = lambda *a: seen.append("failed")
try:
    with tempfile.TemporaryDirectory() as td:
        mod.ensure_agent_dir(td)
        s = mod.Session(issue_number=1, worktree_path=td)
        (Path(td) / ".agent" / "done.md").write_text("ok")
        mod.classify_end(s, "o", "r")
        check("done.md -> done", seen == ["done"])
        seen.clear()
        (Path(td) / ".agent" / "done.md").unlink()
        (Path(td) / ".agent" / "clarification.md").write_text("q?")
        mod.classify_end(s, "o", "r")
        check("clarification.md -> waiting", seen == ["waiting"])
        seen.clear()
        (Path(td) / ".agent" / "clarification.md").unlink()
        (Path(td) / ".agent" / "error.md").write_text("boom")
        mod.classify_end(s, "o", "r")
        check("error.md -> failed", seen == ["failed"])
        seen.clear()
        (Path(td) / ".agent" / "error.md").unlink()
        mod.classify_end(s, "o", "r")
        check("no marker -> failed", seen == ["failed"])
finally:
    mod.finalize_done = real_finalize_done
    mod.enter_waiting = real_enter_waiting
    mod.finalize_failed = real_finalize_failed

print("== get_assigned_issues (PR + assignee filtering) ==")
# Reproduces the real Forgejo behaviour that broke `pending`:
#   * every item in the /issues list carries a `pull_request` key
#     (null for real issues, an object for PRs)  -> key-presence checks fail
#   * the server-side `assignee(s)` filter is ignored (a bogus value still
#     returns everything)                        -> must filter client-side
def make_item(num, title, assignee_login=None, is_pr=False):
    return {
        "number": num,
        "title": title,
        "state": "open",
        "assignee": {"login": assignee_login} if assignee_login else None,
        "assignees": [{"login": assignee_login}] if assignee_login else None,
        # key is ALWAYS present in this Forgejo version:
        "pull_request": {"merged_at": None} if is_pr else None,
    }


payload = [
    make_item(1, "agent issue, pull_request=null", "aiagent"),   # keep
    make_item(2, "agent issue, no pull_request key", "aiagent"),  # keep
    make_item(3, "assigned to someone else", "vlada"),           # drop
    make_item(4, "unassigned", None),                            # drop
    make_item(5, "a PR assigned to agent", "aiagent", is_pr=True),  # drop
]
# Simulate an older Gitea that omits the key entirely for issues:
del payload[1]["pull_request"]

captured = {}


def fake_fj_get(endpoint, params=None):
    captured["endpoint"] = endpoint
    captured["params"] = params
    return payload


real_fj_get = mod.fj_get
mod.fj_get = fake_fj_get
try:
    res = mod.get_assigned_issues("innomenta", "aikion")
    nums = [i["number"] for i in res]
    check("keeps agent issue (pull_request=null)", 1 in nums)
    check("keeps agent issue (no pull_request key)", 2 in nums)
    check("drops issue assigned to someone else", 3 not in nums)
    check("drops unassigned issue", 4 not in nums)
    check("drops PRs", 5 not in nums)
    check("returns exactly the two agent issues", sorted(nums) == [1, 2])
    check("requests use the assignees param",
          (captured.get("params") or {}).get("assignees") == "aiagent")
finally:
    mod.fj_get = real_fj_get

print("== _is_assigned_to ==")
check("single assignee match", mod._is_assigned_to({"assignee": {"login": "aiagent"}}, "aiagent"))
check("assignees list match", mod._is_assigned_to({"assignees": [{"login": "aiagent"}]}, "aiagent"))
check("no assignee -> False", not mod._is_assigned_to({"assignee": None, "assignees": None}, "aiagent"))
check("wrong user -> False", not mod._is_assigned_to({"assignee": {"login": "vlada"}}, "aiagent"))

print(f"\n{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
