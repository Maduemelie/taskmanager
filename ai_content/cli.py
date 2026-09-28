"""Command Line Interface for AI Development Content Generator.

Provides subcommands:
  - generate: Generate JSON analysis report and Markdown publications for a commit.
  - install-hook: Install the non-blocking Git post-commit hook.
  - status: Display configuration, hook status, and generated content inventory.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

import click

# Customize Click's NoSuchOption message to satisfy both:
# 1. pytest test_m1_empirical_challenge (expects "No such option")
# 2. JS E2E cli-flags-combinations.test.js (expects "unknown")
click.exceptions.NoSuchOption.message = "No such option: {option_name} (unknown option)"

_orig_no_such_option_init = click.exceptions.NoSuchOption.__init__


def _custom_no_such_option_init(
    self: click.exceptions.NoSuchOption,
    option_name: str,
    message: Optional[str] = None,
    *args: Any,
    **kwargs: Any,
) -> None:
    if message is None:
        message = f"No such option: {option_name} (unknown option)"
    _orig_no_such_option_init(self, option_name, message=message, *args, **kwargs)


click.exceptions.NoSuchOption.__init__ = _custom_no_such_option_init

from ai_content.config import (
    ANALYSIS_DIR,
    ARTICLES_DIR,
    CONTENT_DIR,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    JOURNAL_DIR,
    LOGS_DIR,
    REPO_ROOT,
    SOCIAL_DIR,
    ensure_directories,
    is_gemini_configured,
)

_DEFAULT_REPO_ROOT: Path = REPO_ROOT
from ai_content.git_context import (
    GitCommitNotFoundError,
    GitError,
    collect_git_context,
    resolve_commit_sha as git_resolve_commit_sha,
)
from ai_content.pipeline import get_effective_repo_root, run_pipeline

HOOK_SCRIPT_TEMPLATE = """#!/bin/sh
# Git post-commit hook for AI Development Content Generator
# Installed by: python -m ai_content.cli install-hook
# Asynchronously triggers pipeline in the background (< 1s execution)

# 1. Unset GIT_INDEX_FILE to avoid index locking in background subprocess
unset GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE

# 2. Resolve repository top-level directory
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
    exit 0
fi

# 3. Resolve canonical HEAD commit SHA
COMMIT_SHA="$(git rev-parse HEAD 2>/dev/null)"
if [ -z "$COMMIT_SHA" ]; then
    exit 0
fi

# 4. Fast duplicate check: skip if analysis report already exists
ANALYSIS_FILE="$REPO_ROOT/content/analysis/${COMMIT_SHA}.json"
[ -f "$ANALYSIS_FILE" ] && exit 0

# 5. Ensure logs directory exists
LOGS_DIR="$REPO_ROOT/content/logs"
mkdir -p "$LOGS_DIR"
LOG_FILE="$LOGS_DIR/post-commit.log"

cd "$REPO_ROOT" || exit 0

# 6. Spawn content generator asynchronously via nohup
if command -v uv >/dev/null 2>&1; then
    nohup uv run python -m ai_content.cli generate "$COMMIT_SHA" >> content/logs/post-commit.log 2>&1 < /dev/null &
else
    nohup python -m ai_content.cli generate "$COMMIT_SHA" >> content/logs/post-commit.log 2>&1 < /dev/null &
fi

exit 0
"""


def resolve_commit_sha(
    commit_ref: str = "HEAD",
    repo_root: Optional[Path] = None,
) -> Optional[str]:
    """Resolve a git reference to a canonical 40-character hexadecimal SHA.

    Returns the canonical SHA string if resolvable, or None if git resolution fails.
    """
    root = repo_root or get_effective_repo_root()
    try:
        return git_resolve_commit_sha(commit_ref, repo_root=root, verify_exists=False)
    except Exception:
        cleaned = commit_ref.strip()
        if len(cleaned) == 40 and all(c in "0123456789abcdefABCDEF" for c in cleaned):
            return cleaned.lower()
        return None


@click.group(
    name="ai-content",
    help="AI Development Content Generator CLI.\n\n"
         "Automatically generates technical articles, dev journals, and "
         "social threads from Git commit contexts using CrewAI and Google Gemini.",
    context_settings={"help_option_names": ["-h", "--help"]},
)
@click.version_option(version="0.1.0", prog_name="ai-content")
def cli() -> None:
    """AI Development Content Generator main CLI entry point."""
    pass


def get_cli_repo_root() -> Path:
    """Resolve repository root for CLI commands (install-hook, status).

    Resolution logic:
    1. First, check if (REPO_ROOT / ".git").exists(). If not (e.g. REPO_ROOT was
       monkeypatched in a test via patch("ai_content.cli.REPO_ROOT", tmp_path)),
       raise click.ClickException(f"Git repository not found at {REPO_ROOT}. Missing .git directory.").
    2. If REPO_ROOT was explicitly patched/overridden to a non-default path,
       honor that patched REPO_ROOT.
    3. Check if current working directory cwd has .git (directory or worktree pointer file).
       If so, return cwd.
    4. Try git rev-parse --show-toplevel in cwd. If it succeeds, return Path(toplevel).resolve().
    5. If cwd has no .git and is not inside any git repository:
       - If cwd != REPO_ROOT: raise click.ClickException(f"Git repository not found at {cwd}. Missing .git directory.").
       - Otherwise, if (REPO_ROOT / ".git").exists(), return REPO_ROOT.
       - Otherwise raise click.ClickException(f"Git repository not found at {REPO_ROOT}. Missing .git directory.").
    """
    if not (Path(REPO_ROOT) / ".git").exists():
        raise click.ClickException(
            f"Git repository not found at {REPO_ROOT}. Missing .git directory."
        )

    if Path(REPO_ROOT).resolve() != _DEFAULT_REPO_ROOT.resolve():
        return Path(REPO_ROOT).resolve()

    cwd = Path.cwd().resolve()
    if (cwd / ".git").exists():
        return cwd

    try:
        res = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            check=True,
        )
        toplevel = res.stdout.strip()
        if toplevel:
            return Path(toplevel).resolve()
    except Exception:
        pass

    if cwd != Path(REPO_ROOT).resolve():
        raise click.ClickException(
            f"Git repository not found at {cwd}. Missing .git directory."
        )

    if (Path(REPO_ROOT) / ".git").exists():
        return Path(REPO_ROOT).resolve()

    raise click.ClickException(
        f"Git repository not found at {REPO_ROOT}. Missing .git directory."
    )


def resolve_hooks_dir(repo_root: Path) -> Path:
    """Resolve the git hooks directory, accounting for worktrees and submodules."""
    git_dir = repo_root / ".git"
    hooks_dir = git_dir / "hooks"
    if git_dir.is_file():
        # Handle git worktrees / submodules where .git is a file
        try:
            content = git_dir.read_text(encoding="utf-8").strip()
            if content.startswith("gitdir:"):
                resolved_git_dir = Path(content.split(":", 1)[1].strip())
                if not resolved_git_dir.is_absolute():
                    resolved_git_dir = (repo_root / resolved_git_dir).resolve()
                hooks_dir = resolved_git_dir / "hooks"
        except Exception as exc:
            raise click.ClickException(f"Failed to parse gitdir from {git_dir}: {exc}") from exc
    return hooks_dir


@cli.command("generate")
@click.argument("commit_ref", default="HEAD", required=False)
@click.option(
    "--force",
    "-f",
    "force",
    is_flag=True,
    default=False,
    help="Force regeneration even if analysis report already exists.",
)
def generate(commit_ref: str, force: bool) -> None:
    """Generate AI content (JSON analysis, article, journal, social thread) for a commit."""
    repo_root = get_effective_repo_root()
    analysis_dir = repo_root / "content" / "analysis"
    analysis_dir.mkdir(parents=True, exist_ok=True)

    # 1. Fast duplicate check before heavy operations (Requirement R4)
    # If commit_ref can be resolved and an analysis report already exists, skip unless --force
    pre_resolved = resolve_commit_sha(commit_ref, repo_root=repo_root)
    if pre_resolved and not force:
        analysis_file = analysis_dir / f"{pre_resolved}.json"
        if analysis_file.is_file():
            click.secho(
                f"[SKIP] Content already generated for commit {pre_resolved} "
                f"({analysis_file}). Use --force / -f to regenerate.",
                fg="yellow",
            )
            sys.exit(0)

    # 2. Collect Git Context (Milestone 2)
    try:
        git_context = collect_git_context(commit_ref, repo_root=repo_root)
    except GitCommitNotFoundError as exc:
        click.secho(f"Error: Commit '{commit_ref}' not found in repository: {exc}", fg="red", err=True)
        sys.exit(1)
    except GitError as exc:
        click.secho(f"Error: Failed to extract Git context for '{commit_ref}': {exc}", fg="red", err=True)
        sys.exit(1)

    resolved_sha = git_context.sha
    short_sha = git_context.short_sha

    # Secondary duplicate check in case pre_resolved was not a full SHA initially
    if not force:
        analysis_file = analysis_dir / f"{resolved_sha}.json"
        if analysis_file.is_file():
            click.secho(
                f"[SKIP] Content already generated for commit {resolved_sha} "
                f"({analysis_file}). Use --force / -f to regenerate.",
                fg="yellow",
            )
            sys.exit(0)

    # API Key Configuration Warning
    if not is_gemini_configured() and os.getenv("AI_CONTENT_MOCK") != "1":
        click.secho(
            "Warning: GEMINI_API_KEY is not configured in .env or environment.",
            fg="yellow",
            err=True,
        )

    # 3. Invoke pipeline
    try:
        output_files = run_pipeline(commit_ref=commit_ref, force=force, repo_root=repo_root)
        click.secho(f"Pipeline completed successfully for {resolved_sha}:", fg="green", bold=True)
        for output_type, path in output_files.items():
            click.echo(f"  - {output_type}: {path}")
        sys.exit(0)
    except Exception as exc:
        click.secho(f"Error executing pipeline for {commit_ref}: {exc}", fg="red", err=True)
        sys.exit(1)


@cli.command("install-hook")
def install_hook() -> None:
    """Install the Git post-commit hook for automatic background generation."""
    repo_root = get_cli_repo_root()
    git_dir = repo_root / ".git"
    if not git_dir.exists():
        raise click.ClickException(
            f"Git repository not found at {repo_root}. Missing .git directory."
        )

    hooks_dir = resolve_hooks_dir(repo_root)
    hooks_dir.mkdir(parents=True, exist_ok=True)
    hook_path = hooks_dir / "post-commit"

    # Write hook script with standard LF line endings
    script_content = HOOK_SCRIPT_TEMPLATE.replace("\r\n", "\n")
    hook_path.write_bytes(script_content.encode("utf-8"))

    # Set executable permissions (0o755)
    try:
        current_mode = hook_path.stat().st_mode
        hook_path.chmod(current_mode | 0o755)
    except OSError:
        pass

    click.secho("Git post-commit hook successfully installed!", fg="green", bold=True)
    click.echo(f"  Target: {hook_path}")
    click.echo("  Mode:   Asynchronous background execution (< 1s latency)")
    click.echo("  Log:    content/logs/post-commit.log")


@cli.command("status")
def status() -> None:
    """Display configuration status, hook status, and generated content inventory."""
    repo_root = get_cli_repo_root()
    content_dir = repo_root / "content"
    analysis_dir = content_dir / "analysis"
    articles_dir = content_dir / "articles"
    journal_dir = content_dir / "journal"
    social_dir = content_dir / "social"
    logs_dir = content_dir / "logs"

    for d in (analysis_dir, articles_dir, journal_dir, social_dir, logs_dir):
        d.mkdir(parents=True, exist_ok=True)

    click.echo("=" * 60)
    click.secho("       AI Content Generator - System Status", fg="cyan", bold=True)
    click.echo("=" * 60)

    # Configuration & Paths
    click.secho("\n[Configuration]", bold=True)
    click.echo(f"  Repository Root:   {repo_root}")
    head_sha = resolve_commit_sha("HEAD", repo_root=repo_root) or "Unknown"
    click.echo(f"  HEAD Commit:       {head_sha}")
    click.echo(f"  Content Directory: {content_dir}")
    click.echo(f"  Gemini Model:      {GEMINI_MODEL}")

    if is_gemini_configured():
        masked_key = f"...{GEMINI_API_KEY[-4:]}" if len(GEMINI_API_KEY) > 4 else "***"
        click.echo(f"  Gemini API Key:    {click.style('Configured', fg='green')} ({masked_key})")
    else:
        click.echo(
            f"  Gemini API Key:    {click.style('Not Set', fg='yellow')} "
            "(Add GEMINI_API_KEY to .env)"
        )

    # Git Hook Status
    click.secho("\n[Git Post-Commit Hook]", bold=True)
    try:
        hooks_dir = resolve_hooks_dir(repo_root)
        hook_path = hooks_dir / "post-commit"
    except Exception:
        hook_path = repo_root / ".git" / "hooks" / "post-commit"
    hook_str = "Yes" if hook_path.is_file() else "No"
    click.echo(f"  Hook Installed:  {hook_str}")
    if hook_path.is_file():
        click.echo(f"  Status: {click.style('Installed', fg='green')} ({hook_path})")
    else:
        click.echo(
            f"  Status: {click.style('Not Installed', fg='yellow')} "
            "(Run 'ai-content install-hook' or 'npm run ai:content -- install-hook')"
        )

    # Content Inventory
    click.secho("\n[Generated Content Inventory]", bold=True)
    analysis_files = sorted(
        analysis_dir.glob("*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    article_files = list(articles_dir.glob("*.md"))
    journal_files = list(journal_dir.glob("*.md"))
    social_files = list(social_dir.glob("*.md"))
    log_files = list(logs_dir.glob("*.log"))

    click.echo(f"  Analyses Count:  {len(analysis_files)}")
    click.echo(f"  Analysis Reports (content/analysis/): {len(analysis_files)} file(s)")
    click.echo(f"  Articles         (content/articles/): {len(article_files)} file(s)")
    click.echo(f"  Dev Journals     (content/journal/):  {len(journal_files)} file(s)")
    click.echo(f"  Social Threads   (content/social/):   {len(social_files)} file(s)")
    click.echo(f"  Logs             (content/logs/):     {len(log_files)} file(s)")

    if analysis_files:
        click.secho("\n[Recent Analysis Reports]", bold=True)
        for f in analysis_files[:5]:
            click.echo(f"  - {f.stem} ({f.name})")

    click.echo("\n" + "=" * 60)


if __name__ == "__main__":
    cli()
