"""Data models: Session and AgentState with serialization."""

import json
import os
import logging
from dataclasses import dataclass, field, fields
from typing import Optional

from config import STATE_FILE

logger = logging.getLogger(__name__)


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
        """Atomic write: temp file + rename so a crash never corrupts state."""
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.to_dict(), indent=2))
        os.replace(tmp, STATE_FILE)

    @classmethod
    def load(cls) -> "AgentState":
        if STATE_FILE.exists():
            try:
                return cls.from_dict(json.loads(STATE_FILE.read_text()))
            except Exception as e:
                logger.warning(f"Failed to load state ({e}); starting fresh")
        return cls()
