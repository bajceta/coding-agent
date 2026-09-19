# Improvement Plan — `ai-agent.py` (Forgejo AI Agent Daemon)

> Goal: make the agent pipeline **robust**, surface **progress in the Forgejo PR**, and let the agent **ask for clarification in Forgejo comments** when it is unsure.

---

## 1. Executive summary

The daemon works as a happy-path prototype: poll assigned issues → create worktree + PR → launch `agent` in a tmux session → react to a few `/commands` in PR comments. It is not production-grade. Three things are missing that map directly to the stated goals:

1. **Robustness** — several latent bugs and a hard blocker mean the daemon can crash on start, leak unlimited sessions, corrupt its state, or run an agent forever with no completion handling.
2. **Progress visibility** — today the PR gets exactly **one** comment ("🤖 Agent started") and nothing else, ever. There is no way to see what the agent is doing, when it finished, or what it produced.
3. **Clarification loop** — there is no mechanism for the agent to say "I'm blocked, I need an answer" and for a human reply to resume it.

The plan below is ordered by priority (P0 = fix first, P1 = the two feature goals, P2 = polish). Each item is concrete and includes a short code sketch where it helps.

---

## 2. Current-state analysis

### 2.1 What it does well

- Clean separation: data models (`Session`, `AgentState`), Forgejo layer, git/worktree layer, tmux layer, main loop, CLI.
- Persistent state file with load/save.
- Idempotency attempts: reuses existing worktrees, searches for an existing PR before failing.
- Graceful shutdown on SIGINT/SIGTERM.
- Sensible CLI subcommands (`daemon`, `pick`, `status`, `check`, `clean`, `cleanup`).

### 2.2 Critical issues (P0 — fix before anything else)

| #   | Issue                                                                                                                                                                                                                                                              | Evidence                                                         | Impact                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| C1  | **Repo identity comes only from `git remote get-url origin`.** The current checkout has **no `origin`** (`git remote get-url origin` → `error: No such remote 'origin'`).                                                                                          | verified locally                                                 | `get_repo_info()` raises → daemon `sys.exit(1)` on every start. Cannot run.               |
| C2  | **`max_concurrent_sessions` is dead config.** It is in `CONFIG` but never read. The loop processes _every_ new issue and spawns a tmux session with no cap.                                                                                                        | grep: only defined, never used                                   | Unbounded tmux sessions / CPU / tokens under load.                                        |
| C3  | **Agent completion is never detected.** `check_agent_status()` is only used to _skip_ already-running issues. Nothing in the loop notices a tmux session has **ended**, so a finished agent is never marked `done`, never gets a "done" comment, never cleaned up. | `run_daemon` only calls `check_new_issues` + `check_pr_comments` | Sessions pile up as "processing" forever; no progress/summary; worktrees never reclaimed. |
| C4  | **`if Path(worktree_path) / "pnpm-lock.yaml":` is always true.** A `Path` object is always truthy regardless of existence.                                                                                                                                         | `process_new_issue`                                              | `pnpm install` is attempted on every repo, even non-JS ones. Should be `.exists()`.       |
| C5  | **The prompt tells the agent to run `task push`, but no Taskfile/task runner exists.**                                                                                                                                                                             | `agent_prompt` string; `ls Taskfile*` → none                     | The agent will be confused / fail the final push step.                                    |
| C6  | **State file is written non-atomically** (`STATE_FILE.write_text`). A crash or two overlapping writers corrupts the JSON; `from_dict` then starts "fresh", losing all sessions.                                                                                    | `AgentState.save`                                                | Loss of tracking on crash; possible double-processing after recovery.                     |

### 2.3 Fragility (P0/P1)

- **CLI text-parsing for data.** `fetch_assigned_issues`, `fetch_open_prs`, `get_issue_body`, `extract_issue_from_pr`, `create_pr` all `re.match` on human-formatted `fj` output (e.g. `^#(\d+):\s+(.+?)\s+\(by\s+\w+\)$`). Any change to `fj`'s format silently breaks the daemon. The same data is available reliably via the REST API (which the code _also_ uses for comments). **Recommendation: do all Forgejo _reads_ through the REST API; keep `fj` only if an action has no clean API equivalent.**
- **Silent, undifferentiated API errors.** `forgejo_api_get` returns `[]` for auth failure, network error, 404, and "empty list" alike. A bad/expired `FORGEJO_TOKEN` means every comment silently fails forever with only a log line. `post_comment` also swallows exceptions and returns `None`.
- **Unbounded `processed_comments`.** Grows forever in memory and the state file.
- **Prompt passed as a single argv string** (`agent ... -q <prompt>`). Large/multi-line prompts hit `ARG_MAX` and quoting edge cases. The agent supports `-f <file>` to read the question from a file — use it.
- **Bot reacts to its own comments.** `check_pr_comments` reads _all_ PR comments including the daemon's own ("🤖 Agent started…"). `parse_commands` matches `/word` anywhere in multiline text, so a markdown link or a bot comment containing a slash-word can false-trigger. Must filter by author (bot vs human) and anchor commands to line start.
- **No timeout / watchdog** on a running agent. A hung session holds a slot indefinitely.
- **`fj pr view` per PR** in `_find_existing_pr` is O(N) and slow.
- **`ThreadPoolExecutor` / `as_completed` imported but unused.**

### 2.4 Leverage the `agent` CLI (verified from `agent --help`)

These existing flags unlock the feature goals with little custom code:

| Flag                       | Purpose                                      | Use here                                                     |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `-f <file>`                | Read the question from a file                | Avoid `ARG_MAX`/quoting; write prompt to `.agent/prompt.md`  |
| `--save <file>`            | Persist conversation to JSON after each turn | `.agent/session.json` — enables resume                       |
| `--continue <file>`        | Load a saved session and continue            | Resume after clarification / retry                           |
| `-l <file>`                | Log file                                     | `.agent/agent.log` — source of progress to surface in the PR |
| `--silent`                 | Suppress output except final message         | Cleaner capture of the final summary                         |
| `-y` / `--yolo`            | Allow all tools without confirmation         | Needed for unattended `--mode run`                           |
| `--reasoning-effort <lvl>` | Cost/quality knob                            | Tune per task                                                |
| `--fj [issue_number]`      | Agent-side issue pickup + worktree + PR      | Possible simplification — see §5.5                           |

---

## 3. Proposed architecture

### 3.1 One source of truth: the Forgejo REST API

Replace CLI-text-parsing for all _reads_ (issues, PRs, comments, labels) with the API. Keep a thin, well-tested client with:

- typed errors (auth / network / not-found) instead of `[]`,
- retry + backoff,
- capture of response bodies (especially the **comment id** on create, needed for the status-comment edit pattern).

Standard Gitea/Forgejo endpoints used:

```
GET   /repos/{o}/{r}/issues?state=open&assignee={user}     # assigned issues
GET   /repos/{o}/{r}/issues/{n}/comments                   # comments (issues & PRs share this)
POST  /repos/{o}/{r}/issues/{n}/comments                   # create comment  -> returns {id}
PATCH /repos/{o}/{r}/issues/{comment_id}                   # edit comment (progress)
GET   /repos/{o}/{r}/pulls?state=open                      # open PRs
POST  /repos/{o}/{r}/pulls                                 # create PR
PUT   /repos/{o}/{r}/issues/{n}/labels                     # replace labels
```

### 3.2 A file-based agent ↔ daemon protocol

The agent and daemon coordinate through a small `.agent/` directory in the worktree. This is robust to whatever the agent prints. Convention:

```
.agent/
  prompt.md         # input: the task (written by daemon)
  session.json      # agent conversation (saved/resumed via --save/--continue)
  agent.log         # agent log (source of progress)
  clarification.md  # agent -> daemon: "I need an answer" (presence = paused)
  done.md           # agent -> daemon: success + summary
  error.md          # agent -> daemon: failure + reason
```

**Completion semantics** (fixes C3): when the tmux session ends, the daemon inspects `.agent/`:

- `done.md` present → **success** → post summary, `ai:done` label, schedule cleanup.
- `clarification.md` present → **paused, awaiting input** → post the question, wait for a human reply.
- `error.md` present → **failure** → post reason, `ai:failed` label.
- none of the above → **abnormal end** → treat as failure/timeout, post "stopped unexpectedly".

The agent is instructed (via a rules file / prompt preamble) to **always end a run by writing exactly one of `done.md` / `clarification.md` / `error.md`** so the daemon has an unambiguous signal.

### 3.3 Session lifecycle (state machine)

```
            new issue
                 │
                 ▼
            PROCESSING ──────────────┐
                 │                   │ (tmux session ends)
                 │  .agent/clarification.md
                 ▼                   │
        WAITING_CLARIFICATION ◄──────┘  (post ❓ question, wait)
                 │
                 │  human reply detected
                 ▼
            PROCESSING  (resume with --continue + reply)
                 │
   ┌─────────────┼─────────────┐
   │             │             │
done.md      error.md      timeout/abnormal
   │             │             │
   ▼             ▼             ▼
   DONE        FAILED        FAILED
```

Each transition posts to the PR (progress/clarification/summary) and updates labels.

### 3.4 Concurrency + watchdog

- Before spawning, count **live** `agent-*` tmux sessions; if ≥ `max_concurrent_sessions`, defer (leave the issue assigned, retry next poll).
- Every poll, for each `PROCESSING` session: if `now - started_at > MAX_RUNTIME`, kill the session, mark `FAILED` (timeout), post a comment. This bounds resource use and token spend.

---

## 4. Prioritized recommendations

### P0 — Robustness (do first)

**R1. Make repo identity configurable (fixes C1).**
Resolve owner/repo in this order: env `FORGEJO_OWNER`/`FORGEJO_REPO` → `git remote` → fail with a clear message. This lets the daemon run from any clone or a bare dir.

```python
def get_repo_info():
    o = os.environ.get("FORGEJO_OWNER"); r = os.environ.get("FORGEJO_REPO")
    if o and r:
        return o, r, git("rev-parse", "--show-toplevel")
    # ...existing git-remote parsing as fallback...
```

Also validate `FORGEJO_TOKEN` once at startup (call a lightweight endpoint like `GET /user`) and abort early with a clear error if auth fails — don't fail silently per-comment.

**R2. Enforce `max_concurrent_sessions` (fixes C2).**

```python
def live_agent_count():
    res = subprocess.run(["tmux", "list-sessions"], capture_output=True, text=True)
    return sum(1 for line in res.stdout.splitlines()
               if line.split(":")[0].startswith("agent-"))

# in check_new_issues, before process_new_issue:
if live_agent_count() >= CONFIG["max_concurrent_sessions"]:
    logger.info("At capacity, deferring issue #%s", issue_num); continue
```

**R3. Detect completion and drive the lifecycle (fixes C3).**
Add a `reconcile_sessions(state, owner, repo)` step to the main loop. For each `PROCESSING` session whose tmux session has ended, inspect `.agent/` (per §3.2) and transition. This is the backbone for both the progress goal and the cleanup goal.

**R4. Atomic state writes (fixes C6).**

```python
def save(self):
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(self.to_dict(), indent=2))
    os.replace(tmp, STATE_FILE)   # atomic on POSIX
```

**R5. Fix the pnpm guard (fixes C4):** `if (Path(worktree_path)/"pnpm-lock.yaml").exists():`.

**R6. Fix the push instruction (fixes C5):** either ship a `Taskfile` with a `push` task, or change the prompt to `git push`. Recommend `git push` for zero extra dependencies, and add a pre-push `git pull --rebase` to reduce conflicts.

**R7. Pass the prompt via file (robustness).** Write `.agent/prompt.md`; launch `agent --mode run -y -f .agent/prompt.md --save .agent/session.json -l .agent/agent.log --silent`. Removes `ARG_MAX`/quoting risk and gives us the log + resumable session for free.

**R8. Only react to human comments, anchored commands.**

- Filter out comments authored by the bot account (match `user.login == FORGEJO_BOT_LOGIN`, default `aiagent`).
- Require the command at the **start of a line** (`^\s*/(retry|continue|stop|debug)\b`).
- Cap `processed_comments` (keep the most recent N, or store only `{comment_id: timestamp}` and prune older than X days).

**R9. Typed, retried Forgejo client.** Distinguish auth/network/404; retry transient (5xx, network) with exponential backoff + jitter; log clearly. Never collapse all errors to `[]`.

### P1 — Goal: see progress in the Forgejo PR

**P1-A. One editable "Status" comment per PR (no spam).**
Instead of posting a new comment per event, the daemon maintains a **single** status comment and **edits** it (PATCH) as things change. On first run, create it and store its `id` in the session. Every poll, while `PROCESSING`, refresh it with:

- current phase (from the latest `.agent/*` marker or log tail),
- elapsed time,
- last ~10 lines of `.agent/agent.log` (sanitized),
- number of commits on the branch vs base.

```python
def upsert_status_comment(owner, repo, session, text):
    if session.status_comment_id:
        forgejo_api_patch(f"/repos/{owner}/{repo}/issues/{session.status_comment_id}", {"body": text})
    else:
        cid = forgejo_api_post(.../issues/{session.pr_number}/comments", {"body": text})
        session.status_comment_id = cid
```

This gives a live dashboard in the PR without flooding it.

**P1-B. Surface real milestones, not just raw log.**
Parse the agent log / git state for meaningful events and reflect them in the status comment:

- "Started", "Working on `<file>`", "Running tests", "Committed `<hash> <msg>`", "Pushed".
- A `git log base..branch --oneline` diff-stat is a strong, cheap progress signal — update it each poll.

**P1-C. Post a completion summary.**
On `done.md`, post (into the status comment and/or a final comment):

- list of commits (`git log base..branch --oneline`),
- `git diff --stat base...branch`,
- test/build result if captured,
- link to the branch/PR head.
  Then apply `ai:done` and (optionally, after a grace period) clean up the worktree.

### P1 — Goal: agent asks for clarification in Forgejo comments

**P1-D. Clarification protocol (file-based, resumable).**

1. The agent's rules/prompt preamble states: _"If you are blocked or uncertain about requirements, do NOT guess. Write your specific question(s) to `.agent/clarification.md` and stop the run."_
2. Because the run stops, the tmux session ends. `reconcile_sessions` sees `clarification.md` → transitions to `WAITING_CLARIFICATION`, posts the question to the PR (and the issue) with a clear marker, e.g.:
    ```
    ❓ **Clarification needed**
    > <contents of clarification.md>
    Reply to this thread and the agent will resume automatically.
    ```
    and records `clarification_comment_id` + the id of the last human comment seen.
3. On each poll while `WAITING_CLARIFICATION`, fetch PR comments; if there is a **new human** comment with `id > clarification_comment_id`, treat it as the answer:
    - append the Q→A to a new prompt file,
    - resume with `agent --mode run -y --continue .agent/session.json -f .agent/reply.md --save .agent/session.json -l .agent/agent.log`,
    - delete `clarification.md`, transition back to `PROCESSING`, update the status comment ("▶️ Resumed with your answer").
4. Guard against loops: only the _first_ new human reply resumes; ignore further replies until the next clarification.

This reuses the agent's native `--save`/`--continue`, so the resumed run keeps full context — no re-explaining.

**P1-E. (Optional) Let the agent post directly.** If the agent has Forgejo tooling, it could post the clarification comment itself. But the daemon must still be the one to detect the pause and resume, so the file-marker contract (§3.2) is still required. Prefer the daemon posting the comment for consistent formatting and de-duplication.

### P2 — Polish

- Structured, per-session logging (correlation id = issue number); separate log file per session alongside `.agent/agent.log`.
- Config file / env for all tunables (intervals, timeouts, labels, bot login) instead of hardcoded `CONFIG`.
- Remove unused imports (`ThreadPoolExecutor`, `as_completed`) or actually use a pool for independent per-issue work.
- Health/watchdog: a top-level try/except that survives a bad poll and a "last heartbeat" field in state so an external monitor can detect a stuck daemon.
- Add unit tests for the pure functions: `parse_commands`, `get_repo_info`, the `.agent/` classification, and the status-comment builder.
- Consider `flock` on the state file if more than one process could run.

---

## 5. Design notes / decisions

### 5.1 Why a file-based protocol over parsing agent output

Parsing free-form LLM output for "done/need-help" is brittle. A marker file written by the agent (enforced by its rules) is deterministic and trivial to detect. It also decouples the daemon from the agent's exact CLI/output format.

### 5.2 Why one editable status comment

Posting a new comment per poll would spam the PR within minutes. Editing a single comment (PATCH by comment id) is the idiomatic way to show live progress and keeps the thread clean. It requires capturing the comment id on creation (currently discarded).

### 5.3 Why resume via `--continue`

The agent already persists conversations to JSON. Resuming the same session after a clarification preserves reasoning and avoids re-doing work — cheaper and more coherent than starting fresh with a stitched-together prompt.

### 5.4 Distinguishing end-of-run reasons

`done.md` / `clarification.md` / `error.md` / none gives four unambiguous terminal states. Without this, "session ended" is ambiguous (success vs. crash vs. paused) — the root cause of C3.

### 5.5 Optional simplification: `agent --fj <issue_number>`

The agent can itself pick an issue, create the worktree and PR (`--fj [issue_number]`). If its behavior is reliable, the daemon's `create_worktree`/`create_pr`/`install_dependencies` could be delegated to the agent, shrinking the daemon to: _detect assigned issue → launch `agent --fj N` with the protocol → monitor → post progress → handle clarification → cleanup._ **Recommendation:** evaluate `--fj` in isolation first; if it is solid, adopt it and delete the duplicated git/PR logic. Until then, keep the daemon's own worktree/PR code (hardened per P0).

---

## 6. Phased roadmap

**Phase 0 — Unblock + harden (P0).** R1 (configurable repo + token validation), R2 (concurrency cap), R4 (atomic state), R5/R6 (pnpm + push fixes), R7 (prompt via file), R8 (human-only, anchored commands), R9 (typed/retried client). _Outcome: daemon runs from any clone, bounded resources, no silent failures._

**Phase 1 — Lifecycle + progress (C3, P1-A/B/C).** Implement `.agent/` protocol + `reconcile_sessions` + completion classification; add the editable status comment with log-tail + diff-stat; post completion summaries and apply labels/cleanup. _Outcome: a live progress dashboard in the PR and automatic done/failed handling._

**Phase 2 — Clarification loop (P1-D/E).** Wire `clarification.md` → question comment → detect human reply → resume with `--continue`. _Outcome: agent blocks on doubt, asks in the PR, and resumes on reply._

**Phase 3 — Polish (P2).** Config, structured logging, tests, watchdog; decide on `--fj` delegation (§5.5).

---

## 7. Open questions (decide before Phase 1)

1. **Bot identity:** what is the `login` of the account that posts comments (so we can filter our own comments)? Default assumed `aiagent` — confirm.
2. **Where to ask:** clarification on the **PR**, the **issue**, or both? (Suggested: PR, mirror to issue.)
3. **Cleanup timing:** auto-remove worktrees immediately on `done`, or keep for a grace window (e.g. 24 h) in case of follow-up?
4. **Auto-merge vs. human review:** should a `done` PR be merged automatically, or left for a human to review? (Suggested: leave for review.)
5. **Timeout policy:** `MAX_RUNTIME` value and what to do on timeout (kill + `ai:failed` + comment).
6. **Delegation:** adopt `agent --fj` (§5.5) or keep daemon-side worktree/PR management?
7. **Concurrency model:** simple tmux-count cap (recommended) vs. a real worker pool.

---

## 8. Appendix — `agent` CLI flags (verified)

```
--mode <mode>          read | write | run     (run = all tools allowed)
-y, --yolo             allow all tools without confirmation
-it, --interactive     interactive mode
-q <text>              question as argument
-f [files...]          read question/content from file(s)   <- preferred
-l, --log-file <file>  log file path                        <- progress source
--save <file>          save conversation to JSON each turn  <- resume
--continue <file>      load a saved session and continue    <- resume
--silent               suppress output except final message
-m, --model <name>     model selection
-re, --reasoning-effort <low|mid|xhigh>   cost/quality knob
--fj [issue_number]    agent-side Forgejo issue pickup + worktree + PR
-P, --parser <type>    native | plain | json
```

Suggested launch (unattended, resumable, logged):

```
agent --mode run -y -f .agent/prompt.md \
      --save .agent/session.json --continue .agent/session.json \
      -l .agent/agent.log --silent
```

(`--continue` is a no-op when the file doesn't yet exist on the first run; confirm this behavior, otherwise omit it on the initial launch and add it only on resume.)
