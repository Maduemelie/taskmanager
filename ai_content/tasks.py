"""CrewAI Task Definitions for AI Development Content Generator.

Implements task factories binding agents, prompts, and output schemas:
  - create_context_analyst_task: Extracts structured DevelopmentSessionReport.
  - create_technical_writer_task: Drafts deep-dive technical Markdown article.
  - create_journal_writer_task: Drafts reflective developer journal entry.
  - create_social_writer_task: Drafts 5-tweet Twitter/X thread.
  - create_quality_reviewer_task: Audits and finalizes publications with delimiters.
"""

from __future__ import annotations

from typing import List, Optional

from crewai import Agent, Task
from ai_content.git_context import GitCommitContext
from ai_content.models import DevelopmentSessionReport


def create_context_analyst_task(
    agent: Agent,
    git_context: GitCommitContext,
) -> Task:
    """Create the Context Analyst Task to produce a DevelopmentSessionReport."""
    prompt_context = git_context.to_prompt_context(max_diff_chars=30000)

    description = f"""Analyze the provided Git commit context and produce a structured DevelopmentSessionReport JSON object.

{prompt_context}

### REQUIRED OUTPUT FIELDS & CONSTRAINTS:
1. `commit_sha`: Must be exactly "{git_context.sha}" (the canonical 40-character lowercase hex SHA).
2. `timestamp`: Must be "{git_context.date}" (the ISO-8601 commit timestamp).
3. `summary`: A concise, informative executive summary (minimum 11 characters) describing what changed and why.
4. `architecture_impact`: A descriptive technical assessment (minimum 11 characters) of how this commit impacts system design, dependencies, component boundaries, APIs, or performance. If this is an empty commit, explicitly state that zero file deltas occurred with minimal architectural impact.
5. `key_takeaways`: A JSON array of 1 to 4 concrete, actionable technical takeaways from this commit (each item must be a non-empty string).
6. `changed_components`: A JSON array of modified system components, directories, or modules (e.g. ["js", "views", "api"]). If no files changed, use ["core"].
7. `suggested_article_title`: A compelling, clear technical article headline summarizing the feature or fix.
8. `suggested_article_slug`: A valid kebab-case URL/file slug (e.g. "add-single-target-sweet-spot-pricing") matching ^[a-z0-9]+(?:-[a-z0-9]+)*$. Lowercase letters, numbers, and single hyphens only. No punctuation or symbols.

### CRITICAL RULES:
- Output ONLY valid JSON matching the DevelopmentSessionReport schema.
- Do NOT add any extra fields (extra fields are strictly forbidden by schema).
- Ensure `summary` and `architecture_impact` are descriptive and exceed 10 characters in length.
- Ensure `suggested_article_slug` is strictly kebab-case without leading/trailing hyphens.
- Ground all facts strictly in the commit metadata and diff.
"""
    expected_output = (
        f"A valid JSON object conforming to the DevelopmentSessionReport schema for commit "
        f"{git_context.short_sha} containing commit_sha, timestamp, summary, architecture_impact, "
        "key_takeaways, changed_components, suggested_article_title, and suggested_article_slug."
    )

    return Task(
        description=description.strip(),
        expected_output=expected_output.strip(),
        agent=agent,
        output_pydantic=DevelopmentSessionReport,
    )


def create_technical_writer_task(
    agent: Agent,
    git_context: GitCommitContext,
    context_tasks: Optional[List[Task]] = None,
    context: Optional[List[Task]] = None,
) -> Task:
    """Create the Technical Writer Task to produce a technical Markdown article."""
    dep_tasks = context_tasks if context_tasks is not None else context
    changed_files_summary = (
        ", ".join(f.filename for f in git_context.changed_files)
        if git_context.changed_files
        else "None (empty commit)"
    )

    description = f"""Author a comprehensive, publication-ready technical Markdown article based on the DevelopmentSessionReport and the Git commit context.

### Commit Metadata:
- Commit SHA: {git_context.sha}
- Short SHA: {git_context.short_sha}
- Author: {git_context.author_name} <{git_context.author_email}>
- Date: {git_context.date}
- Subject: {git_context.message_subject}
- Files Changed: {changed_files_summary}

### Required Structure & Guidelines:
1. YAML Frontmatter:
   ```yaml
   ---
   title: "<suggested_article_title>"
   slug: "<suggested_article_slug>"
   date: "{git_context.date}"
   author: "{git_context.author_name}"
   commit: "{git_context.sha}"
   ---
   ```
2. Top-level H1 heading: `# <suggested_article_title>` (or `# {git_context.message_subject}`).
3. Mandatory Sections (Must include these exact headings):
   - `## Executive Summary` (High-level overview describing what changed, motivation, and system impact)
   - `## Architectural Breakdown` (Detailed analysis of component interactions, architectural shifts, and design trade-offs)
   - `## Changes Overview` (Granular breakdown of modified files, classes, algorithms, and key code additions)
   - `## Key Technical Takeaways` (Bulleted list of key engineering lessons, patterns, and principles learned)
4. Footer citation: `_Commit {git_context.sha} by {git_context.author_name} on {git_context.date}_`.

Ensure the article is technically rigorous, contains well-fenced code blocks where applicable, exceeds 50 characters, and contains zero hallucinations.
"""
    expected_output = (
        f"A complete publication-ready technical Markdown article for commit {git_context.short_sha} "
        f"featuring YAML frontmatter, an H1 heading, '## Executive Summary', '## Architectural Breakdown', "
        f"'## Changes Overview', '## Key Technical Takeaways', and author citation footer."
    )

    kwargs = {
        "description": description.strip(),
        "expected_output": expected_output.strip(),
        "agent": agent,
    }
    if dep_tasks:
        kwargs["context"] = list(dep_tasks)
    return Task(**kwargs)


def create_journal_writer_task(
    agent: Agent,
    git_context: GitCommitContext,
    context_tasks: Optional[List[Task]] = None,
    context: Optional[List[Task]] = None,
) -> Task:
    """Create the Journal Writer Task to produce a developer journal entry."""
    dep_tasks = context_tasks if context_tasks is not None else context
    description = f"""Write an authentic, candid first-person developer journal entry documenting the implementation session for commit {git_context.short_sha}.

### Commit Metadata:
- Commit SHA: {git_context.sha} ({git_context.short_sha})
- Author: {git_context.author_name}
- Date: {git_context.date}
- Subject: {git_context.message_subject}
- Files Changed: {len(git_context.changed_files)} file(s)

### Required Structure & Tone:
1. Title: `# Development Journal — {git_context.short_sha}` (you may append `: {git_context.message_subject}`)
2. Metadata bullet points:
   - **Date**: {git_context.date}
   - **Commit**: `{git_context.sha}` ({git_context.short_sha})
   - **Author**: {git_context.author_name}
3. Mandatory Sections:
   - `## Session Overview` (First-person narrative describing what was built or refactored and why)
   - `## Engineering Challenges & Decisions` (Real-world friction, trade-offs, debugging, and why specific approaches were chosen)
   - `## Next Steps` (Immediate follow-up items, verification goals, and upcoming work)

Adopt an honest developer voice. Make sure the short SHA '{git_context.short_sha}' and full SHA are clearly cited. Minimum 30 characters.
"""
    expected_output = (
        f"A reflective Markdown developer journal entry starting with '# Development Journal — {git_context.short_sha}', "
        f"citing commit {git_context.sha}, containing '## Session Overview', '## Engineering Challenges & Decisions', and '## Next Steps'."
    )
    kwargs = {
        "description": description.strip(),
        "expected_output": expected_output.strip(),
        "agent": agent,
    }
    if dep_tasks:
        kwargs["context"] = list(dep_tasks)
    return Task(**kwargs)


def create_social_writer_task(
    agent: Agent,
    git_context: GitCommitContext,
    context_tasks: Optional[List[Task]] = None,
    context: Optional[List[Task]] = None,
) -> Task:
    """Create the Social Media Writer Task to produce an X/Twitter thread."""
    dep_tasks = context_tasks if context_tasks is not None else context
    description = f"""Craft an engaging 5-tweet Twitter/X technical thread for commit {git_context.short_sha}: "{git_context.message_subject}".

### Guidelines:
1. Structure as 5 numbered tweets: `1/5`, `2/5`, `3/5`, `4/5`, `5/5`, separated by double newlines (`\\n\\n`).
2. Every individual tweet MUST be strictly under 280 characters.
3. Content breakdown:
   - `1/5`: Hook announcing commit {git_context.short_sha} with 🧵 emoji and feature summary.
   - `2/5`: The core problem and architectural design approach.
   - `3/5`: Implementation highlight or clever code technique.
   - `4/5`: Main technical takeaway or lesson learned.
   - `5/5`: Call-to-action mentioning the article path `content/articles/{git_context.sha}-<slug>.md` and hashtags #devlog #coding #ai.
"""
    expected_output = (
        f"A 5-tweet Markdown social thread for commit {git_context.short_sha} with tweets numbered "
        "1/5 through 5/5, separated by double newlines, each strictly under 280 characters."
    )
    kwargs = {
        "description": description.strip(),
        "expected_output": expected_output.strip(),
        "agent": agent,
    }
    if dep_tasks:
        kwargs["context"] = list(dep_tasks)
    return Task(**kwargs)


def create_quality_reviewer_task(
    agent: Agent,
    git_context: GitCommitContext,
    context_tasks: Optional[List[Task]] = None,
    context: Optional[List[Task]] = None,
) -> Task:
    """Create the Quality Reviewer Task to audit and finalize publications."""
    dep_tasks = context_tasks if context_tasks is not None else context
    changed_files_summary = (
        ", ".join(f.filename for f in git_context.changed_files)
        if git_context.changed_files
        else "None (empty commit)"
    )

    description = f"""Audit and finalize the draft technical article, developer journal, and social media thread for commit {git_context.short_sha} ({git_context.sha}).

Inspect the drafts against the DevelopmentSessionReport and Git commit metadata:
1. Technical Article:
   - Must have a top-level H1 heading: `# <suggested_article_title>` or `# {git_context.message_subject}`.
   - Must contain exact section headings: '## Executive Summary', '## Architectural Breakdown', '## Changes Overview', '## Key Technical Takeaways'.
   - Ensure all cited files exist in the commit: {changed_files_summary}.
2. Dev Journal:
   - Must begin with '# Development Journal — {git_context.short_sha}'.
   - Must cite commit SHA '{git_context.sha}' or '{git_context.short_sha}', date '{git_context.date}', and author '{git_context.author_name}'.
   - Must contain '## Session Overview', '## Engineering Challenges & Decisions', and '## Next Steps'.
3. Social Thread:
   - Must contain numbered tweets (e.g. 1/5, 2/5, 3/5, 4/5, 5/5) separated by double newlines.
   - Each tweet must be strictly under 280 characters.
4. Markdown Quality:
   - Ensure all code blocks are properly fenced with triple backticks and language tags.
   - Ensure no broken links or malformed markdown.

Format your output with clear delimiter blocks so the publications can be extracted and written to disk:
===ARTICLE===
[Final Technical Article Markdown]
===JOURNAL===
[Final Dev Journal Markdown]
===SOCIAL===
[Final Social Media Thread Markdown]
"""
    expected_output = (
        "Finalized, audited markdown publications separated by ===ARTICLE===, ===JOURNAL===, and ===SOCIAL=== delimiters."
    )
    kwargs = {
        "description": description.strip(),
        "expected_output": expected_output.strip(),
        "agent": agent,
    }
    if dep_tasks:
        kwargs["context"] = list(dep_tasks)
    return Task(**kwargs)


# Backward compatibility aliases
create_context_analysis_task = create_context_analyst_task
create_technical_article_task = create_technical_writer_task
create_journal_task = create_journal_writer_task
create_social_task = create_social_writer_task
create_quality_review_task = create_quality_reviewer_task
