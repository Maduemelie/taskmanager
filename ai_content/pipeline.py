"""CrewAI Pipeline Orchestrator for AI Development Content Generator.

Orchestrates the sequential CrewAI multi-agent workflow:
  1. Context Analyst: Analyzes git context and produces DevelopmentSessionReport.
  2. Content Writers: Technical Writer, Journal Writer, Social Writer.
  3. Quality Reviewer: Audits drafts against JSON report and finalizes publications.

Features:
  - Dynamic repository root resolution (git rev-parse --show-toplevel).
  - Fast duplicate check before execution (skips if content/analysis/<sha>.json exists unless force=True).
  - Atomic writing (.tmp -> os.replace) for all output files.
  - Explicit deterministic Mock Mode (AI_CONTENT_MOCK=1) for offline test runs.
  - Returns dictionary of created file paths.
"""

from __future__ import annotations

import os
import re
import subprocess
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, Optional, Tuple, Union

from ai_content.config import (
    ANALYSIS_DIR,
    ARTICLES_DIR,
    CONTENT_DIR,
    JOURNAL_DIR,
    LOGS_DIR,
    REPO_ROOT,
)
from ai_content.git_context import GitCommitContext, collect_git_context
from ai_content.models import DevelopmentSessionReport, slugify
from ai_content.validation import ensure_article_frontmatter, strip_asterisk_emphasis, validate_publications

if TYPE_CHECKING:
    from crewai import LLM


def get_effective_repo_root(
    explicit_root: Optional[Union[str, Path]] = None,
    cwd: Optional[Union[str, Path]] = None,
) -> Path:
    """Resolve the active repository root directory.

    Checks:
    1. explicit_root parameter if provided.
    2. Check if (target_cwd / ".git").exists() directly.
    3. git rev-parse --show-toplevel from cwd or current working directory.
    4. REPO_ROOT from config.py as fallback.
    """
    if explicit_root:
        return Path(explicit_root).resolve()
    target_cwd = Path(cwd).resolve() if cwd else Path.cwd().resolve()
    if (target_cwd / ".git").exists():
        return target_cwd
    try:
        res = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=str(target_cwd),
            capture_output=True,
            text=True,
            check=True,
        )
        toplevel = res.stdout.strip()
        if toplevel:
            return Path(toplevel).resolve()
    except Exception:
        pass
    return REPO_ROOT


def is_mock_mode(mock: Optional[bool] = None) -> bool:
    """Check if pipeline should run in Mock Mode.

    Explicit parameter overrides environment. Mocking must be requested explicitly;
    missing credentials are generation failures, not permission to emit mock content.
    """
    if mock is not None:
        return bool(mock)
    env_mock = os.getenv("AI_CONTENT_MOCK", "").strip().lower()
    if env_mock in ("1", "true", "yes"):
        return True
    if env_mock in ("0", "false", "no"):
        return False
    return False


def atomic_write_text(
    filepath: Union[str, Path],
    content: str,
    encoding: str = "utf-8",
) -> Path:
    """Atomically write text content to filepath using a temporary file and os.replace.

    Guarantees no half-written or corrupted files remain on sudden interruption.
    Temporary files are placed in the same directory and unlinked if any error occurs.
    """
    dest_path = Path(filepath).resolve()
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_filename = f".tmp_{os.getpid()}_{time.time_ns() % 1000000}"
    temp_path = dest_path.parent / temp_filename

    str_temp = str(temp_path)
    str_dest = str(dest_path)
    if os.name == "nt":
        if not str_temp.startswith("\\\\?\\"):
            str_temp = f"\\\\?\\{str_temp}"
        if not str_dest.startswith("\\\\?\\"):
            str_dest = f"\\\\?\\{str_dest}"

    try:
        with open(str_temp, "w", encoding=encoding) as f:
            f.write(content)
        os.replace(str_temp, str_dest)  # Atomic NTFS and POSIX rename
    except Exception:
        try:
            if os.path.exists(str_temp):
                os.unlink(str_temp)
        except OSError:
            pass
        raise
    return dest_path


def generate_mock_content(
    git_context: GitCommitContext,
) -> Tuple[DevelopmentSessionReport, str, str, str]:
    """Deterministically generate valid report and markdown content without external API calls.

    Generates:
      - 100% schema-compliant DevelopmentSessionReport
      - Deep-dive technical article with YAML frontmatter, H1, Executive Summary, Architectural Breakdown,
        Changes Overview, and Key Technical Takeaways
      - Developer journal entry starting with '# Development Journal — <short_sha>' and citing commit metadata
      - 5-tweet Twitter/X thread numbered 1/5 to 5/5, with each tweet under 280 characters
    """
    sha = git_context.sha
    short_sha = git_context.short_sha
    subject = git_context.message_subject
    body = git_context.message_body
    author = git_context.author_name
    date = git_context.date

    slug = slugify(subject)
    title = f"Technical Deep Dive: {subject}"

    # Extract distinct component directories
    components = sorted({
        str(Path(f.filename).parent).replace("\\", "/")
        for f in git_context.changed_files
        if str(Path(f.filename).parent) not in (".", "")
    })
    if not components:
        components = ["core"]

    extended_info = f" {body.strip()}" if body.strip() else " Session completed cleanly with all invariants preserved."
    summary_text = (
        f"Automated development session analysis for commit {short_sha}: {subject}.{extended_info}"
    )
    if len(summary_text) <= 10:
        summary_text = f"Automated analysis for commit {short_sha}: {subject}."

    file_names = [f.filename for f in git_context.changed_files]
    if file_names:
        files_preview = ", ".join(file_names[:3])
        if len(file_names) > 3:
            files_preview += f" and {len(file_names) - 3} other(s)"
        impact_text = (
            f"Modifications across {len(file_names)} file(s) ({files_preview}) "
            "maintain component boundaries, architectural integrity, and system invariants."
        )
    else:
        impact_text = "Zero file delta detected (empty commit). Minimal architectural impact on system invariants."

    takeaways = [
        f"Analyzed commit {short_sha}: {subject[:50]}",
        f"Changed files count: {len(git_context.changed_files)}",
        "Verified atomic writing and schema compliance",
    ]

    report = DevelopmentSessionReport(
        commit_sha=sha,
        timestamp=date,
        summary=summary_text,
        architecture_impact=impact_text,
        key_takeaways=takeaways,
        changed_components=components,
        suggested_article_title=title,
        suggested_article_slug=slug,
    )

    # 1. Technical Article Markdown
    files_list = (
        "\n".join(f"- `{f.filename}` ({f.status_description}, +{f.additions}, -{f.deletions})" for f in git_context.changed_files)
        if git_context.changed_files
        else "_No file changes in this commit._"
    )
    takeaways_list = "\n".join(f"- {t}" for t in report.key_takeaways)

    article_md = f"""---
title: "{title}"
slug: "{slug}"
date: "{date}"
author: "{author}"
commit: "{sha}"
---

# {title}

## Executive Summary
{report.summary}

## Architectural Breakdown
{report.architecture_impact}

## Changes Overview
{files_list}

## Key Technical Takeaways
{takeaways_list}

_Commit {sha} by {author} on {date}_
""".strip()

    # 2. Dev Journal Markdown
    files_count = len(git_context.changed_files)
    journal_md = f"""# Development Journal — {short_sha}

- **Date**: {date}
- **Commit**: `{sha}` ({short_sha})
- **Author**: {author}
- **Files Modified**: {files_count} file(s)

## Session Overview
{report.summary}

## Engineering Challenges & Decisions
Addressed modifications across {files_count} file(s). Ensured atomic file persistence and strict idempotency across consecutive executions.

## Next Steps
Proceed with comprehensive integration testing, regression checks, and milestone verification.
""".strip()

    # 3. Social Thread Markdown (1/5 to 5/5, each <= 280 chars)
    t1_subj = subject[:70]
    tweet_1 = f"1/5 🚀 Pushed commit {short_sha}: {t1_subj}! 🧵 Here is a breakdown of what changed:"
    tweet_2 = f"2/5 🏗️ Architecture & Context:\n{summary_text[:200]}"
    tweet_3 = f"3/5 💻 Engineering Implementation:\n{impact_text[:200]}"
    tweet_4 = f"4/5 💡 Key Takeaway:\n{takeaways[0][:200]}"
    tweet_5 = f"5/5 📚 Full technical article generated at content/articles/{sha}-{slug}.md #devlog #coding #ai"

    # Verify each tweet <= 280 chars
    tweets = [tweet_1, tweet_2, tweet_3, tweet_4, tweet_5]
    trimmed_tweets = [t if len(t) <= 280 else t[:277] + "..." for t in tweets]
    social_md = "\n\n".join(trimmed_tweets)

    return report, article_md, journal_md, social_md


def execute_crew_pipeline(
    git_context: GitCommitContext,
    llm: Optional[LLM] = None,
) -> Tuple[DevelopmentSessionReport, str, str, str]:
    """Execute live CrewAI sequential pipeline with Google Gemini."""
    from crewai import Crew, Process
    from ai_content.agents import (
        create_context_analyst_agent,
        create_journal_writer_agent,
        create_quality_reviewer_agent,
        create_social_writer_agent,
        create_technical_writer_agent,
        get_llm,
    )
    from ai_content.tasks import (
        create_context_analyst_task,
        create_journal_writer_task,
        create_quality_reviewer_task,
        create_social_writer_task,
        create_technical_writer_task,
    )

    resolved_llm = llm if llm is not None else get_llm()

    # 1. Instantiate Agents
    analyst_agent = create_context_analyst_agent(llm=resolved_llm)
    tech_writer_agent = create_technical_writer_agent(llm=resolved_llm)
    journal_writer_agent = create_journal_writer_agent(llm=resolved_llm)
    social_writer_agent = create_social_writer_agent(llm=resolved_llm)
    reviewer_agent = create_quality_reviewer_agent(llm=resolved_llm)

    # 2. Instantiate Tasks with sequential dependencies
    task_analyst = create_context_analyst_task(analyst_agent, git_context)
    task_article = create_technical_writer_task(tech_writer_agent, git_context, context_tasks=[task_analyst])
    task_journal = create_journal_writer_task(journal_writer_agent, git_context, context_tasks=[task_analyst])
    task_social = create_social_writer_task(social_writer_agent, git_context, context_tasks=[task_analyst])
    task_review = create_quality_reviewer_task(
        reviewer_agent,
        git_context,
        context_tasks=[task_analyst, task_article, task_journal, task_social],
    )

    # 3. Instantiate Crew and Kickoff
    crew = Crew(
        agents=[analyst_agent, tech_writer_agent, journal_writer_agent, social_writer_agent, reviewer_agent],
        tasks=[task_analyst, task_article, task_journal, task_social, task_review],
        process=Process.sequential,
        verbose=False,
    )

    crew.kickoff()

    # 4. Extract DevelopmentSessionReport
    report: Optional[DevelopmentSessionReport] = None
    if task_analyst.output:
        if task_analyst.output.pydantic and isinstance(task_analyst.output.pydantic, DevelopmentSessionReport):
            report = task_analyst.output.pydantic
        elif task_analyst.output.raw:
            try:
                raw_text = task_analyst.output.raw.strip()
                if raw_text.startswith("```"):
                    raw_text = re.sub(r"^```[a-zA-Z]*\r?\n?", "", raw_text)
                    raw_text = re.sub(r"\r?\n?```$", "", raw_text).strip()
                report = DevelopmentSessionReport.model_validate_json(raw_text)
            except Exception:
                pass

    # A schema-invalid analyst result must stop publication, not silently turn
    # into synthetic/mock content that looks like a successful generation.
    if report is None:
        raise ValueError("The LLM did not return a valid DevelopmentSessionReport")

    # 5. Extract Markdown publications from Reviewer output
    review_raw = task_review.output.raw if task_review.output and task_review.output.raw else ""
    article_md = ""
    journal_md = ""
    social_md = ""

    if "===ARTICLE===" in review_raw and "===JOURNAL===" in review_raw and "===SOCIAL===" in review_raw:
        try:
            parts = review_raw.split("===ARTICLE===")[1]
            art_part, rest = parts.split("===JOURNAL===")
            jrn_part, soc_part = rest.split("===SOCIAL===")
            if art_part.strip():
                article_md = art_part.strip()
            if jrn_part.strip():
                journal_md = jrn_part.strip()
            if soc_part.strip():
                social_md = soc_part.strip()
        except Exception:
            pass
    else:
        # Extract each writer result. Missing output is rejected by validation;
        # synthetic content is never substituted for an LLM failure.
        if task_article.output and task_article.output.raw and len(task_article.output.raw.strip()) >= 50:
            article_md = task_article.output.raw.strip()
        if task_journal.output and task_journal.output.raw and len(task_journal.output.raw.strip()) >= 30:
            journal_md = task_journal.output.raw.strip()
        if task_social.output and task_social.output.raw and len(task_social.output.raw.strip()) >= 20:
            social_md = task_social.output.raw.strip()

    article_md = ensure_article_frontmatter(article_md, report, git_context)
    article_md = strip_asterisk_emphasis(article_md)
    journal_md = strip_asterisk_emphasis(journal_md)
    social_md = strip_asterisk_emphasis(social_md)
    validate_publications(report, article_md, journal_md, social_md, git_context)
    return report, article_md, journal_md, social_md


def run_pipeline(
    commit_ref: str = "HEAD",
    force: bool = False,
    mock: Optional[bool] = None,
    repo_root: Optional[Union[str, Path]] = None,
    staged_context: Optional[GitCommitContext] = None,
) -> Dict[str, Path]:
    """Execute the AI development content generation pipeline for a commit.

    Args:
        commit_ref: Git reference (HEAD, branch, tag, short SHA, or 40-char SHA).
        force: If True, overwrite existing generated content files.
        mock: If True, force mock mode; if False, force live mode; if None, auto-detect.
        repo_root: Optional repository root override.

    Returns:
        Dictionary mapping content types ("analysis", "article", "journal", "social")
        to their created file Path objects.
    """
    root = get_effective_repo_root(repo_root)

    analysis_dir = root / "content" / "analysis"
    articles_dir = root / "content" / "articles"
    journal_dir = root / "content" / "journal"
    social_dir = root / "content" / "social"
    logs_dir = root / "content" / "logs"

    for d in (analysis_dir, articles_dir, journal_dir, social_dir, logs_dir):
        d.mkdir(parents=True, exist_ok=True)

    # 1. Collect Git Context
    git_context = staged_context or collect_git_context(commit_ref=commit_ref, repo_root=root)
    sha = git_context.sha
    short_sha = git_context.short_sha

    # A commit SHA does not exist until after the commit-msg hook. Stage the
    # validated result under a tree+subject key, then post-commit remaps it.
    if staged_context is not None:
        pending_id = f"{sha}-{slugify(git_context.message_subject)}"
        pending_root = root / "content" / ".pending" / pending_id
        analysis_dir = pending_root / "analysis"
        articles_dir = pending_root / "articles"
        journal_dir = pending_root / "journal"
        social_dir = pending_root / "social"
        logs_dir = pending_root / "logs"
        for d in (analysis_dir, articles_dir, journal_dir, social_dir, logs_dir):
            d.mkdir(parents=True, exist_ok=True)

    # 2. Duplicate Check
    analysis_file = analysis_dir / f"{sha}.json"
    if analysis_file.is_file() and not force and staged_context is None:
        existing_articles = sorted(articles_dir.glob(f"{sha}*.md"))
        existing_journals = sorted(journal_dir.glob(f"{sha}*.md"))
        existing_socials = sorted(social_dir.glob(f"{sha}*.md"))
        slug = slugify(git_context.message_subject)

        return {
            "analysis": analysis_file,
            "article": existing_articles[0] if existing_articles else articles_dir / f"{sha}-{slug}.md",
            "journal": existing_journals[0] if existing_journals else journal_dir / f"{sha}-{slug}.md",
            "social": existing_socials[0] if existing_socials else social_dir / f"{sha}-{slug}.md",
        }

    # 3. Mode Execution
    use_mock = is_mock_mode(mock)
    if staged_context is not None and use_mock:
        raise ValueError("Commit-time generation requires a live free-tier LLM; mock mode is not allowed")
    if use_mock:
        report, article_md, journal_md, social_md = generate_mock_content(git_context)
    else:
        from ai_content.agents import get_free_llm_candidates

        candidates = get_free_llm_candidates()
        if not candidates:
            raise ValueError("No free LLM provider is configured. Set GEMINI_API_KEY or GROQ_API_KEY.")
        failures = []
        for provider_name, provider_llm in candidates:
            try:
                report, article_md, journal_md, social_md = execute_crew_pipeline(
                    git_context, llm=provider_llm
                )
                break
            except Exception as exc:
                safe_error = str(exc)
                for secret_name in ("GEMINI_API_KEY", "GROQ_API_KEY"):
                    secret = os.getenv(secret_name, "")
                    if secret:
                        safe_error = safe_error.replace(secret, "[redacted]")
                failures.append(f"{provider_name}: {safe_error}")
        else:
            details = " | ".join(failures)
            raise RuntimeError(f"All configured free LLM providers failed: {details}")

    if not use_mock:
        article_md = strip_asterisk_emphasis(article_md)
        journal_md = strip_asterisk_emphasis(journal_md)
        social_md = strip_asterisk_emphasis(social_md)
        validate_publications(report, article_md, journal_md, social_md, git_context)

    # 4. Atomic File Writing
    slug = report.suggested_article_slug
    article_file = articles_dir / f"{sha}-{slug}.md"
    journal_file = journal_dir / f"{sha}-{slug}.md"
    social_file = social_dir / f"{sha}-{slug}.md"

    # Atomically write JSON report via DevelopmentSessionReport.to_json_file
    report.to_json_file(analysis_file, atomic=True)

    # Atomically write Markdown deliverables
    atomic_write_text(article_file, article_md)
    atomic_write_text(journal_file, journal_md)
    atomic_write_text(social_file, social_md)

    return {
        "analysis": analysis_file,
        "article": article_file,
        "journal": journal_file,
        "social": social_file,
    }
