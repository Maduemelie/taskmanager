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
import warnings
from typing import Optional

from crewai import Agent, LLM
from ai_content.config import (
    GEMINI_API_KEY, GEMINI_MODEL, GROQ_API_KEY, GROQ_MODEL, is_gemini_configured,
)


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


def get_free_llm_candidates() -> list[tuple[str, LLM]]:
    """Return configured free-tier candidates in preferred order: Gemini, then Groq."""
    if os.getenv("AI_CONTENT_MOCK") == "1":
        return []
    candidates: list[tuple[str, LLM]] = []
    gemini_key = os.getenv("GEMINI_API_KEY") or GEMINI_API_KEY
    if gemini_key and gemini_key.strip():
        gemini_model = os.getenv("GEMINI_MODEL") or GEMINI_MODEL or "gemini/gemini-3.8-flash"
        normalized_gemini_model = gemini_model.removeprefix("gemini/").removeprefix("google/")
        if normalized_gemini_model != "gemini-3.8-flash":
            warnings.warn("Ignoring GEMINI_MODEL outside the free-model allowlist; expected gemini-3.8-flash.")
            gemini_model = ""
        if gemini_model:
            if not gemini_model.startswith(("gemini/", "google/")):
                gemini_model = f"gemini/{gemini_model}"
            candidates.append(("Gemini", LLM(model=gemini_model, api_key=gemini_key.strip(), temperature=0.2)))

    groq_key = os.getenv("GROQ_API_KEY") or GROQ_API_KEY
    if groq_key and groq_key.strip():
        groq_model = os.getenv("GROQ_MODEL") or GROQ_MODEL or "openai/gpt-oss-120b"
        normalized_groq_model = groq_model.removeprefix("groq/")
        if normalized_groq_model != "openai/gpt-oss-120b":
            warnings.warn("Ignoring GROQ_MODEL outside the free-model allowlist; expected openai/gpt-oss-120b.")
        else:
            # CrewAI removes the first provider prefix, so repeat `openai/` to
            # preserve Groq's actual model ID in the outgoing API request.
            # Use the native OpenAI-compatible client; LiteLLM's `groq/` route
            # can send cache_breakpoint fields that Groq rejects.
            candidates.append((
                "Groq",
                LLM(
                    model="openai/openai/gpt-oss-120b",
                    api_key=groq_key.strip(),
                    base_url="https://api.groq.com/openai/v1",
                    temperature=0.2,
                ),
            ))
    return candidates


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
