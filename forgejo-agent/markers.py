"""Agent marker file protocol (.agent/ directory)."""

from pathlib import Path


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
