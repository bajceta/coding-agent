"""Generic utility helpers."""

import re
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def safe(fn: Callable, default: Any = None) -> Any:
    """Run fn; return default on any exception (logs a warning)."""
    try:
        return fn()
    except Exception as e:
        logger.warning(f"safe: {e}")
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
