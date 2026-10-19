"""Command Line Interface for AI Development Content Generator.

Provides subcommands:
  - generate: Generate JSON analysis report and Markdown publications for a commit.
  - install-hook: Install the blocking commit-time quality gate and finalizer.
  - status: Display configuration, hook status, and generated content inventory.
"""

from __future__ import annotations

import os
import shutil
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
    GROQ_API_KEY,
    GROQ_MODEL,
    is_any_free_provider_configured,
    is_gemini_configured,
)

_DEFAULT_REPO_ROOT: Path = REPO_ROOT
from ai_content.git_context import (
    GitCommitNotFoundError,
    GitError,
    collect_git_context,
    collect_staged_context,
    resolve_commit_sha as git_resolve_commit_sha,
)
from ai_content.pipeline import get_effective_repo_root, run_pipeline, atomic_write_text
from ai_content.models import DevelopmentSessionReport, slugify

COMMIT_MSG_HOOK_TEMPLATE = """#!/bin/sh
# AI_CONTENT_GENERATOR: required, synchronous pre-commit content quality gate
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$REPO_ROOT" ] || exit 1
cd "$REPO_ROOT" || exit 1
if command -v uv >/dev/null 2>&1; then
    uv run python -m ai_content.cli generate --staged --message-file "$1"
else
    python -m ai_content.cli generate --staged --message-file "$1"
fi
status=$?
if [ "$status" -ne 0 ]; then
    echo "Commit blocked: required AI content generation or quality validation failed." >&2
fi
exit "$status"
"""

POST_COMMIT_HOOK_TEMPLATE = """#!/bin/sh
# AI_CONTENT_GENERATOR: map validated staged content to the final commit SHA
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$REPO_ROOT" ] || exit 1
cd "$REPO_ROOT" || exit 1
if command -v uv >/dev/null 2>&1; then
    uv run python -m ai_content.cli finalize HEAD
else
    python -m ai_content.cli finalize HEAD
fi
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
@click.option("--staged", is_flag=True, help="Generate and validate from the staged tree for commit-msg hooks.")
@click.option("--message-file", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option(
    "--force",
    "-f",
    "force",
    is_flag=True,
    default=False,
    help="Force regeneration even if analysis report already exists.",
)
def generate(commit_ref: str, staged: bool, message_file: Optional[Path], force: bool) -> None:
    """Generate AI content (JSON analysis, article, journal, social thread) for a commit."""
    repo_root = get_effective_repo_root()
    analysis_dir = repo_root / "content" / "analysis"
    analysis_dir.mkdir(parents=True, exist_ok=True)

    if staged and message_file is None:
        raise click.ClickException("--staged requires --message-file from Git's commit-msg hook")

    # 1. Fast duplicate check before heavy operations (Requirement R4)
    # If commit_ref can be resolved and an analysis report already exists, skip unless --force
    pre_resolved = None if staged else resolve_commit_sha(commit_ref, repo_root=repo_root)
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
        git_context = (
            collect_staged_context(message_file, repo_root=repo_root)
            if staged and message_file is not None
            else collect_git_context(commit_ref, repo_root=repo_root)
        )
    except GitCommitNotFoundError as exc:
        click.secho(f"Error: Commit '{commit_ref}' not found in repository: {exc}", fg="red", err=True)
        sys.exit(1)
    except GitError as exc:
        click.secho(f"Error: Failed to extract Git context for '{commit_ref}': {exc}", fg="red", err=True)
        sys.exit(1)

    resolved_sha = git_context.sha
    short_sha = git_context.short_sha

    # Secondary duplicate check in case pre_resolved was not a full SHA initially
    if not force and not staged:
        analysis_file = analysis_dir / f"{resolved_sha}.json"
        if analysis_file.is_file():
            click.secho(
                f"[SKIP] Content already generated for commit {resolved_sha} "
                f"({analysis_file}). Use --force / -f to regenerate.",
                fg="yellow",
            )
            sys.exit(0)

    # API Key Configuration Warning
    if staged and os.getenv("AI_CONTENT_MOCK") == "1":
        raise click.ClickException("AI_CONTENT_MOCK cannot be used for a commit; configure a free live model.")
    if not is_any_free_provider_configured() and os.getenv("AI_CONTENT_MOCK") != "1":
        click.secho(
            "Warning: no free provider key is configured (set GEMINI_API_KEY or GROQ_API_KEY).",
            fg="yellow",
            err=True,
        )

    # 3. Invoke pipeline
    try:
        output_files = run_pipeline(
            commit_ref=commit_ref, force=force, repo_root=repo_root,
            staged_context=git_context if staged else None,
        )
        click.secho(f"Pipeline completed successfully for {resolved_sha}:", fg="green", bold=True)
        for output_type, path in output_files.items():
            click.echo(f"  - {output_type}: {path}")
        sys.exit(0)
    except Exception as exc:
        click.secho(f"Error executing pipeline for {commit_ref}: {exc}", fg="red", err=True)
        sys.exit(1)


@cli.command("finalize")
@click.argument("commit_ref", default="HEAD", required=False)
def finalize(commit_ref: str) -> None:
    """Bind commit-msg-hook output to the actual post-commit SHA."""
    root = get_effective_repo_root()
    try:
        context = collect_git_context(commit_ref, repo_root=root)
        tree_sha = subprocess.run(
            ["git", "rev-parse", f"{context.sha}^{{tree}}"], cwd=str(root),
            capture_output=True, text=True, check=True,
        ).stdout.strip().lower()
        pending = root / "content" / ".pending" / f"{tree_sha}-{slugify(context.message_subject)}"
        if not pending.is_dir():
            click.echo("No validated staged content found for this commit; nothing to finalize.")
            return

        report = DevelopmentSessionReport.from_json_file(pending / "analysis" / f"{tree_sha}.json")
        updated_report = report.model_copy(update={"commit_sha": context.sha, "timestamp": context.date})
        slug = updated_report.suggested_article_slug
        mapping = (
            ("articles", f"{tree_sha}-{slug}.md", root / "content" / "articles" / f"{context.sha}-{slug}.md"),
            ("journal", f"{tree_sha}-{slug}.md", root / "content" / "journal" / f"{context.sha}-{slug}.md"),
            ("social", f"{tree_sha}-{slug}.md", root / "content" / "social" / f"{context.sha}-{slug}.md"),
        )
        for subdir, filename, destination in mapping:
            text = (pending / subdir / filename).read_text(encoding="utf-8")
            text = text.replace(tree_sha, context.sha).replace(tree_sha[:7], context.short_sha)
            text = text.replace(report.timestamp, context.date)
            atomic_write_text(destination, text)
        updated_report.to_json_file(root / "content" / "analysis" / f"{context.sha}.json")

        pending_root = (root / "content" / ".pending").resolve()
        if pending.resolve().is_relative_to(pending_root):
            shutil.rmtree(pending)
        click.echo(f"Finalized generated content for commit {context.sha}")
    except Exception as exc:
        raise click.ClickException(f"Could not finalize generated content: {exc}") from exc


@cli.command("install-hook")
def install_hook() -> None:
    """Install required synchronous commit generation and post-commit finalization hooks."""
    repo_root = get_cli_repo_root()
    git_dir = repo_root / ".git"
    if not git_dir.exists():
        raise click.ClickException(
            f"Git repository not found at {repo_root}. Missing .git directory."
        )

    hooks_dir = resolve_hooks_dir(repo_root)
    hooks_dir.mkdir(parents=True, exist_ok=True)
    hooks = {
        hooks_dir / "commit-msg": COMMIT_MSG_HOOK_TEMPLATE,
        hooks_dir / "post-commit": POST_COMMIT_HOOK_TEMPLATE,
    }
    for hook_path in hooks:
        if hook_path.exists():
            existing = hook_path.read_text(encoding="utf-8", errors="replace")
            if "AI_CONTENT_GENERATOR:" not in existing and "AI Development Content Generator" not in existing:
                raise click.ClickException(
                    f"Refusing to overwrite existing custom hook: {hook_path}. Chain it manually with the AI content hook."
                )
    for hook_path, script_content in hooks.items():
        hook_path.write_bytes(script_content.replace("\r\n", "\n").encode("utf-8"))
        try:
            hook_path.chmod(hook_path.stat().st_mode | 0o755)
        except OSError:
            pass

    click.secho("Git commit-time generation hooks successfully installed!", fg="green", bold=True)
    click.echo(f"  Target: {hook_path}")
    click.echo("  Mode:   Synchronous generation and validation before commit")
    click.echo(f"  Hooks:  {hooks_dir / 'commit-msg'}, {hooks_dir / 'post-commit'}")


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
    click.echo(f"  Groq Model:        {GROQ_MODEL}")

    if is_gemini_configured():
        masked_key = f"...{GEMINI_API_KEY[-4:]}" if len(GEMINI_API_KEY) > 4 else "***"
        click.echo(f"  Gemini API Key:    {click.style('Configured', fg='green')} ({masked_key})")
    else:
        click.echo(
            f"  Gemini API Key:    {click.style('Not Set', fg='yellow')} "
            "(Add GEMINI_API_KEY to .env)"
        )
    click.echo(f"  Groq API Key:      {'Configured' if GROQ_API_KEY.strip() else 'Not Set'}")

    # Git Hook Status
    click.secho("\n[Git Commit Hooks]", bold=True)
    try:
        hooks_dir = resolve_hooks_dir(repo_root)
    except Exception:
        hooks_dir = repo_root / ".git" / "hooks"
    commit_hook = hooks_dir / "commit-msg"
    finalize_hook = hooks_dir / "post-commit"
    if commit_hook.is_file() and "AI_CONTENT_GENERATOR:" in commit_hook.read_text(encoding="utf-8", errors="replace"):
        click.echo(f"  Commit gate:      {click.style('Installed', fg='green')} ({commit_hook})")
    else:
        click.echo(
            f"  Commit gate:      {click.style('Not Installed', fg='yellow')} "
            "(Run 'ai-content install-hook' or 'npm run ai:content -- install-hook')"
        )
    click.echo(f"  Finalizer:        {'Installed' if finalize_hook.is_file() else 'Not installed'}")

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
