"""CrewAI Agent Definitions for AI Development Content Generator.

Implements agent factories for the multi-agent content generation pipeline:
  - get_llm: Configured CrewAI LLM for Google Gemini (native google-genai).
  - create_context_analyst_agent: Forensic Git context analyst.
  - create_technical_writer_agent: In-depth technical article author.
  - create_journal_writer_agent: Reflective developer diarist.
  - create_social_writer_agent: High-signal Twitter/X community evangelist.
  - create_quality_reviewer_agent: Fact-checking and style auditing editor.
"""

from __future__ import annotations

import os
from typing import Optional

from crewai import Agent, LLM
from ai_content.config import GEMINI_API_KEY, GEMINI_MODEL, is_gemini_configured


def get_llm(
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    temperature: float = 0.2,
) -> Optional[LLM]:
    """Create and return a configured CrewAI LLM instance for Google Gemini.

    Returns None if running under mock mode (AI_CONTENT_MOCK=1) or if
    no Gemini API key is configured.
    """
    if os.getenv("AI_CONTENT_MOCK") == "1":
        return None

    key = api_key or os.getenv("GEMINI_API_KEY") or GEMINI_API_KEY
    if not key or not key.strip():
        return None

    model_name = model or os.getenv("GEMINI_MODEL") or GEMINI_MODEL or "gemini/gemini-2.5-flash"
    # Ensure standard provider prefix for CrewAI native Gemini completion
    if not model_name.startswith("gemini/") and not model_name.startswith("google/"):
        model_name = f"gemini/{model_name}"

    return LLM(
        model=model_name,
        api_key=key.strip(),
        temperature=temperature,
    )


def create_context_analyst_agent(
    llm: Optional[LLM] = None,
    verbose: bool = False,
) -> Agent:
    """Create the Context Analyst Agent.

    Analyzes Git commit metadata, file modifications, and diffs with forensic
    precision, producing a structured DevelopmentSessionReport.
    """
    resolved_llm = llm if llm is not None else get_llm()
    kwargs = {
        "role": "Senior Technical Git Context Analyst",
        "goal": (
            "Analyze Git commit metadata, file modifications, and code diffs with forensic precision. "
            "Extract key architectural impacts, component changes, technical takeaways, and executive "
            "summaries, producing a strictly conforming DevelopmentSessionReport."
        ),
        "backstory": (
            "You are a Principal Software Architect and Git Forensics Expert with deep expertise in "
            "codebase inspection, diff analysis, and architectural design patterns. You specialize in "
            "analyzing commits across diverse languages and frameworks (JavaScript, Python, C++, shell). "
            "You quickly discern whether changes represent core architectural refactorings, bug fixes, "
            "new features, or documentation updates. You communicate with absolute technical clarity, "
            "never hallucinate uncommitted changes, and strictly adhere to structured data output contracts."
        ),
        "allow_delegation": False,
        "verbose": verbose,
    }
    if resolved_llm is not None:
        kwargs["llm"] = resolved_llm
    return Agent(**kwargs)


def create_technical_writer_agent(
    llm: Optional[LLM] = None,
    verbose: bool = False,
) -> Agent:
    """Create the Technical Writer Agent.

    Authors comprehensive, publication-ready technical markdown articles analyzing
    architectural decisions, code patterns, and engineering trade-offs.
    """
    resolved_llm = llm if llm is not None else get_llm()
    kwargs = {
        "role": "Senior Technical Author & Software Architect",
        "goal": (
            "Author comprehensive, publication-ready technical markdown articles analyzing architectural "
            "decisions, code patterns, and engineering trade-offs from developer commits."
        ),
        "backstory": (
            "You are a distinguished software architect and technical writer who excels at turning code "
            "commits and diffs into clear, readable, in-depth architectural articles. You write with authority "
            "and clarity, structuring articles with pristine YAML frontmatter, production-grade code breakdown, "
            "and actionable takeaways for engineers."
        ),
        "allow_delegation": False,
        "verbose": verbose,
    }
    if resolved_llm is not None:
        kwargs["llm"] = resolved_llm
    return Agent(**kwargs)


def create_journal_writer_agent(
    llm: Optional[LLM] = None,
    verbose: bool = False,
) -> Agent:
    """Create the Journal Writer Agent.

    Writes an authentic, reflective, first-person developer diary capturing behind-the-scenes
    thinking, hurdles, decisions, and personal reflections.
    """
    resolved_llm = llm if llm is not None else get_llm()
    kwargs = {
        "role": "Lead Developer & Engineering Diarist",
        "goal": (
            "Write an authentic, reflective, first-person developer diary documenting the behind-the-scenes "
            "thinking, technical hurdles, design decisions, and personal reflections of building the system."
        ),
        "backstory": (
            "You are a pragmatic lead engineer who keeps an honest, transparent engineering journal. You capture "
            "the real-world friction of debugging, trade-off evaluation, refactoring decisions, and lessons learned "
            "during each coding session. Your writing is relatable, technically grounded, and speaks directly from "
            "developer to developer."
        ),
        "allow_delegation": False,
        "verbose": verbose,
    }
    if resolved_llm is not None:
        kwargs["llm"] = resolved_llm
    return Agent(**kwargs)


def create_social_writer_agent(
    llm: Optional[LLM] = None,
    verbose: bool = False,
) -> Agent:
    """Create the Social Media Writer Agent.

    Crafts high-signal, punchy Twitter/X technical threads summarizing engineering accomplishments,
    architectural breakthroughs, and code lessons for developers.
    """
    resolved_llm = llm if llm is not None else get_llm()
    kwargs = {
        "role": "Tech Community Evangelist & Developer Advocate",
        "goal": (
            "Craft engaging, high-signal, punchy Twitter/X technical threads summarizing engineering accomplishments, "
            "architectural breakthroughs, and code lessons for developers."
        ),
        "backstory": (
            "You are a highly regarded developer advocate with a knack for technical storytelling. You distill complex "
            "systems and code diffs into captivating X/Twitter threads with numbered tweets under 280 characters that "
            "developers love to bookmark and retweet. You avoid fluff and deliver actionable insights."
        ),
        "allow_delegation": False,
        "verbose": verbose,
    }
    if resolved_llm is not None:
        kwargs["llm"] = resolved_llm
    return Agent(**kwargs)


def create_quality_reviewer_agent(
    llm: Optional[LLM] = None,
    verbose: bool = False,
) -> Agent:
    """Create the Quality Reviewer Agent.

    Audits and polishes technical publications against the Git commit context and JSON
    DevelopmentSessionReport for 100% factual accuracy, markdown validity, and style consistency.
    """
    resolved_llm = llm if llm is not None else get_llm()
    kwargs = {
        "role": "Senior Technical Editor & Content Quality Assurance Engineer",
        "goal": (
            "Audit and polish technical publications (technical article, developer journal, "
            "and social media thread) against the Git commit context and JSON DevelopmentSessionReport "
            "for 100% factual accuracy, markdown validity, and style consistency."
        ),
        "backstory": (
            "You are an exacting technical documentation editor and staff quality engineer with years of "
            "experience reviewing open-source releases, API documentation, and engineering blogs. You rigorously "
            "check that every file path and code change described matches the actual git diff, that commit SHAs "
            "and authors are correctly referenced, that markdown syntax is well-formed, and that Twitter threads "
            "adhere to character count limits without truncating thoughts. You never permit vague placeholders, "
            "hallucinated methods, or malformed markdown to pass."
        ),
        "allow_delegation": False,
        "verbose": verbose,
    }
    if resolved_llm is not None:
        kwargs["llm"] = resolved_llm
    return Agent(**kwargs)
