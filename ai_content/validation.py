"""Deterministic quality gates for generated commit publications."""

from __future__ import annotations

import json
import re

from ai_content.git_context import GitCommitContext
from ai_content.models import DevelopmentSessionReport


ARTICLE_SECTIONS = (
    "## Executive Summary",
    "## Architectural Breakdown",
    "## Implementation Details",
    "## Key Technical Takeaways",
)
JOURNAL_SECTIONS = (
    "## Session Overview",
    "## Engineering Challenges & Decisions",
    "## Next Steps",
)
FORBIDDEN_BOILERPLATE = (
    "automated development session analysis",
    "modifications across ",
    "verified atomic writing",
)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(f"Generated content quality check failed: {message}")


def _word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", text))


def ensure_article_frontmatter(
    article: str,
    report: DevelopmentSessionReport,
    context: GitCommitContext,
) -> str:
    """Set canonical YAML metadata from trusted pipeline data, not LLM prose.

    Reviewers sometimes omit or rewrite frontmatter even when asked to preserve
    it. The metadata is deterministic, so repair that wrapper before validating
    the generated article body and title.
    """
    body = article.lstrip()
    existing_frontmatter = re.match(r"\A---\s*\r?\n.*?\r?\n---(?:\r?\n|$)", body, re.DOTALL)
    if existing_frontmatter:
        body = body[existing_frontmatter.end():].lstrip("\r\n")

    fields = {
        "title": report.suggested_article_title.strip(),
        "slug": report.suggested_article_slug.strip(),
        "date": context.date,
        "author": context.author_name,
        "commit": context.sha,
    }
    frontmatter = "\n".join(f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in fields.items())
    citation = f"_Commit {context.sha} by {context.author_name} on {context.date}_"
    body = strip_asterisk_emphasis(body)
    return f"---\n{frontmatter}\n---\n\n{body}\n\n{citation}\n"


def strip_asterisk_emphasis(text: str) -> str:
    """Detect and remove Markdown asterisk emphasis outside fenced code blocks so formatting passes quality gates."""
    lines = []
    in_fence = False
    for line in text.splitlines():
        stripped = line.lstrip()
        if re.match(r"^(?:```|~~~)", stripped):
            in_fence = not in_fence
            lines.append(line)
            continue
        if in_fence:
            lines.append(line)
            continue
        parts = re.split(r"(`[^`]*`)", line)
        cleaned = []
        for part in parts:
            if part.startswith("`") and part.endswith("`"):
                cleaned.append(part)
            else:
                cleaned.append(re.sub(r"(?<!\\)\*{1,3}(?=\S)(.+?)(?<=\S)\*{1,3}", r"\1", part))
        lines.append("".join(cleaned))
    return "\n".join(lines)


def _has_asterisk_emphasis(text: str) -> bool:
    """Detect Markdown emphasis outside fenced code, not literal code/operators."""
    in_fence = False
    for line in text.splitlines():
        stripped = line.lstrip()
        if re.match(r"^(?:```|~~~)", stripped):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        # Inline code is literal text too; its operators and examples are not
        # Markdown emphasis and should not trip the publication style gate.
        markdown_text = re.sub(r"`+.*?`+", "", line)
        if re.search(r"(?<!\\)(\*{1,3})(?=\S)(.+?)(?<=\S)\1(?!\*)", markdown_text):
            return True
    return False


def validate_publications(
    report: DevelopmentSessionReport,
    article: str,
    journal: str,
    social: str,
    context: GitCommitContext,
) -> None:
    """Reject content that is malformed, off-title, incomplete, or boilerplate."""
    _require(report.commit_sha == context.sha, "analysis commit SHA does not match input")
    _require(report.timestamp == context.date, "analysis timestamp does not match input")
    title = report.suggested_article_title.strip()
    _require(15 <= len(title) <= 120, "article title must be 15–120 characters")
    _require(title.casefold() != context.message_subject.strip().casefold(),
             "article title must add useful specificity beyond the raw commit subject")
    _require(not re.search(r"^(update|changes|miscellaneous|technical deep dive)\b", title, re.I),
             "article title is too generic")

    article = article.lstrip()
    _require(article.startswith("---\n"), "article YAML frontmatter is missing")
    frontmatter = article.split("---", 2)
    _require(len(frontmatter) == 3, "article YAML frontmatter is not closed")
    _require(f"title: {json.dumps(title, ensure_ascii=False)}" in frontmatter[1], "article frontmatter title does not match analysis title")
    _require(f"slug: {json.dumps(report.suggested_article_slug, ensure_ascii=False)}" in frontmatter[1], "article slug does not match analysis")
    _require(f"date: {json.dumps(context.date, ensure_ascii=False)}" in frontmatter[1], "article date does not match input")
    _require(f"author: {json.dumps(context.author_name, ensure_ascii=False)}" in frontmatter[1], "article author does not match input")
    _require(f"commit: {json.dumps(context.sha, ensure_ascii=False)}" in frontmatter[1], "article commit SHA does not match input")
    _require(re.search(rf"(?m)^# {re.escape(title)}\s*$", article) is not None,
             "article H1 does not match analysis title")
    for heading in ARTICLE_SECTIONS:
        _require(heading in article, f"article is missing required section {heading}")
    _require(_word_count(frontmatter[2]) > 500, "article body must exceed 500 words")
    _require(f"_Commit {context.sha} by {context.author_name} on {context.date}_" in article,
             "article citation footer does not match input")

    _require(journal.startswith(f"# Development Journal — {context.short_sha}"),
             "journal title does not identify the commit")
    for heading in JOURNAL_SECTIONS:
        _require(heading in journal, f"journal is missing required section {heading}")
    _require(context.sha in journal and context.author_name in journal and context.date in journal,
             "journal is missing matching commit metadata")

    tweets = [part.strip() for part in social.strip().split("\n\n") if part.strip()]
    _require(len(tweets) == 5, "social thread must contain exactly five tweets")
    for index, tweet in enumerate(tweets, start=1):
        _require(tweet.startswith(f"{index}/5"), f"social tweet {index} has incorrect numbering")
        _require(len(tweet) < 280, f"social tweet {index} must be under 280 characters")

    all_text = "\n".join((article, journal, social)).casefold()
    for phrase in FORBIDDEN_BOILERPLATE:
        _require(phrase not in all_text, f"boilerplate phrase is not allowed: {phrase.strip()}")
    for name, text in (("article", article), ("journal", journal), ("social thread", social)):
        _require(not _has_asterisk_emphasis(text), f"asterisk-based emphasis is not allowed in {name}")
