"""Data models for AI Development Content Generator.

Implements Pydantic V2 data models for Git context extraction, file change details,
and development session reports conforming to PROJECT.md specifications.
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

# Regular expression standards matching PROJECT.md and test/ai-content/harness/schema-validator.js
SHA_40_REGEX = re.compile(r"^[0-9a-fA-F]{40}$")
ISO_8601_REGEX = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)
SLUG_REGEX = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
VALID_GIT_STATUSES = frozenset({"A", "M", "D", "R", "C", "T", "U"})


def slugify(text: str) -> str:
    """Convert an arbitrary string into a valid kebab-case slug.

    Transforms text by:
    1. Lowercasing
    2. Replacing all non-alphanumeric sequences (whitespace, punctuation, symbols) with hyphens
    3. Collapsing multiple hyphens
    4. Stripping leading and trailing hyphens

    Defaults to 'content-update' if the resulting slug is empty.

    Args:
        text: Input string (e.g. commit subject line or title).

    Returns:
        A strictly compliant kebab-case slug matching SLUG_REGEX.
    """
    if not text:
        return "content-update"
    s = str(text).strip().lower()
    # Replace all non-alphanumeric character sequences with a single hyphen
    s = re.sub(r"[^a-z0-9]+", "-", s)
    # Strip leading and trailing hyphens
    s = s.strip("-")
    return s or "content-update"


class FileChangeDetail(BaseModel):
    """Details of an individual file modification in a Git commit.

    Attributes:
        filename: Relative repository path to the modified file.
        status: Git change status (A=Added, M=Modified, D=Deleted, R=Renamed, C=Copied, T=Type changed, U=Unmerged).
        additions: Number of lines added (>= 0).
        deletions: Number of lines deleted (>= 0).
        old_filename: Previous path if the file was renamed or copied.
        is_binary: Flag indicating if the file is binary.
    """

    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="allow",
    )

    filename: str = Field(
        ...,
        min_length=1,
        description="Repository relative path to the modified file",
    )
    status: str = Field(
        ...,
        description="Git status code (A, M, D, R, C, T, U)",
    )
    additions: int = Field(
        default=0,
        ge=0,
        description="Count of added lines",
    )
    deletions: int = Field(
        default=0,
        ge=0,
        description="Count of deleted lines",
    )
    old_filename: Optional[str] = Field(
        default=None,
        description="Original path if renamed or copied",
    )
    is_binary: bool = Field(
        default=False,
        description="Whether the file was identified as binary",
    )

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        s = v.strip().upper()
        if s and s[0] in VALID_GIT_STATUSES:
            return s
        raise ValueError(
            f"Invalid git file status: '{v}'. Expected status starting with one of: "
            f"{', '.join(sorted(VALID_GIT_STATUSES))}."
        )

    @property
    def net_change(self) -> int:
        """Net lines changed (additions - deletions)."""
        return self.additions - self.deletions

    @property
    def status_code(self) -> str:
        """Single character status code (e.g. 'A', 'M', 'R')."""
        return self.status[0] if self.status else ""

    @property
    def status_description(self) -> str:
        """Human-readable description of the git status."""
        code = self.status_code
        descriptions = {
            "A": "Added",
            "M": "Modified",
            "D": "Deleted",
            "R": "Renamed",
            "C": "Copied",
            "T": "Type Changed",
            "U": "Unmerged",
        }
        return descriptions.get(code, f"Status({self.status})")

    def format_line(self) -> str:
        """Format as a summary line: '[M] path/to/file (+10, -2)'."""
        diff_badge = f"(+{self.additions}, -{self.deletions})" if not self.is_binary else "(binary)"
        old_part = f" (renamed from {self.old_filename})" if self.old_filename else ""
        return f"[{self.status_code}] {self.filename}{old_part} {diff_badge}"

    def __str__(self) -> str:
        return self.format_line()


class GitCommitContext(BaseModel):
    """Complete metadata and diff representation of a Git commit.

    Attributes:
        sha: Canonical 40-character hexadecimal commit SHA.
        short_sha: Short (typically 7-character) commit SHA.
        author_name: Author name.
        author_email: Author email address.
        date: ISO-8601 formatted commit timestamp string.
        message_subject: First line of commit message (subject).
        message_body: Extended commit message body.
        changed_files: List of FileChangeDetail instances.
        diff: Unified git diff string.
        is_merge: True if the commit is a merge commit (has multiple parents).
        parent_shas: List of parent commit 40-character hexadecimal SHAs.
    """

    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="allow",
    )

    sha: str = Field(
        ...,
        description="Canonical 40-character hexadecimal commit SHA",
    )
    short_sha: str = Field(
        default="",
        description="Short commit SHA (7-12 characters)",
    )
    author_name: str = Field(
        ...,
        min_length=1,
        description="Commit author name",
    )
    author_email: str = Field(
        default="",
        description="Commit author email",
    )
    date: str = Field(
        ...,
        description="ISO-8601 formatted commit date string",
    )
    message_subject: str = Field(
        ...,
        min_length=1,
        description="Commit message headline / subject",
    )
    message_body: str = Field(
        default="",
        description="Commit message extended body description",
    )
    changed_files: List[FileChangeDetail] = Field(
        default_factory=list,
        description="List of file modifications in this commit",
    )
    diff: str = Field(
        default="",
        description="Unified git diff text",
    )
    is_merge: bool = Field(
        default=False,
        description="Whether this commit is a merge commit",
    )
    parent_shas: List[str] = Field(
        default_factory=list,
        description="List of parent commit 40-character hexadecimal SHAs",
    )

    @field_validator("sha")
    @classmethod
    def validate_sha(cls, v: str) -> str:
        cleaned = v.strip().lower()
        if not SHA_40_REGEX.match(cleaned):
            raise ValueError(
                f"Invalid commit SHA '{v}': must be a 40-character hexadecimal string."
            )
        return cleaned

    @field_validator("parent_shas")
    @classmethod
    def validate_parent_shas(cls, v: List[str]) -> List[str]:
        cleaned_parents: List[str] = []
        for p in v:
            p_clean = p.strip().lower()
            if not SHA_40_REGEX.match(p_clean):
                raise ValueError(
                    f"Invalid parent commit SHA '{p}': must be a 40-character hexadecimal string."
                )
            cleaned_parents.append(p_clean)
        return cleaned_parents

    @field_validator("date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        cleaned = v.strip()
        if not ISO_8601_REGEX.match(cleaned):
            # Attempt to parse via datetime to validate and normalize
            try:
                # Replace 'Z' with +00:00 for standard python fromisoformat
                dt = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
                normalized = dt.isoformat()
                if not ISO_8601_REGEX.match(normalized):
                    raise ValueError
                return cleaned
            except Exception:
                raise ValueError(
                    f"Invalid date timestamp '{v}': must be a valid ISO-8601 formatted string "
                    "(e.g. '2026-09-22T11:49:12Z' or '2026-09-22T12:49:12+01:00')."
                )
        return cleaned

    @model_validator(mode="after")
    def populate_derived_fields(self) -> "GitCommitContext":
        # Derive short_sha if empty or validate prefix match
        if not self.short_sha:
            object.__setattr__(self, "short_sha", self.sha[:7])
        else:
            object.__setattr__(self, "short_sha", self.short_sha.strip().lower())

        # Consistent merge flag detection
        if len(self.parent_shas) > 1:
            object.__setattr__(self, "is_merge", True)

        return self

    @property
    def is_root_commit(self) -> bool:
        """True if the commit has no parents (initial root commit)."""
        return len(self.parent_shas) == 0

    @property
    def is_empty_commit(self) -> bool:
        """True if commit introduces no file or diff modifications."""
        return len(self.changed_files) == 0 and not bool(self.diff.strip())

    @property
    def total_additions(self) -> int:
        """Total lines added across all changed files."""
        return sum(f.additions for f in self.changed_files)

    @property
    def total_deletions(self) -> int:
        """Total lines deleted across all changed files."""
        return sum(f.deletions for f in self.changed_files)

    @property
    def total_files_changed(self) -> int:
        """Total number of modified files."""
        return len(self.changed_files)

    def diff_summary(self) -> str:
        """Concise git stat line: '3 files changed, 45 insertions(+), 12 deletions(-)'."""
        count = len(self.changed_files)
        files_str = f"{count} file{'s' if count != 1 else ''} changed"
        ins_str = f"{self.total_additions} insertion{'' if self.total_additions == 1 else 's'}(+)"
        del_str = f"{self.total_deletions} deletion{'' if self.total_deletions == 1 else 's'}(-)"
        return f"{files_str}, {ins_str}, {del_str}"

    def to_prompt_context(self, max_diff_chars: Optional[int] = 30000) -> str:
        """Format commit context into structured Markdown block for CrewAI LLM prompts.

        Args:
            max_diff_chars: Maximum characters allowed for diff before truncation.
                            Pass None to disable truncation.

        Returns:
            Structured Markdown string suitable for AI Context Analyst.
        """
        if self.changed_files:
            table_lines = [
                "| Status | File | Additions | Deletions |",
                "|---|---|---|---|",
            ]
            for f in self.changed_files:
                table_lines.append(
                    f"| {f.status_code} | `{f.filename}` | +{f.additions} | -{f.deletions} |"
                )
            files_block = "\n".join(table_lines)
        else:
            files_block = "_No file changes detected (empty commit)._"

        diff_content = self.diff
        if max_diff_chars is not None and len(diff_content) > max_diff_chars:
            diff_content = (
                diff_content[:max_diff_chars]
                + f"\n\n... [DIFF TRUNCATED: {len(self.diff)} characters total, showing first {max_diff_chars} characters] ..."
            )

        parents_str = (
            ", ".join(f"`{p[:7]}`" for p in self.parent_shas)
            if self.parent_shas
            else "None (root commit)"
        )
        merge_str = "Yes" if self.is_merge else "No"
        extended_body = (
            f"\n\n### Extended Message\n{self.message_body.strip()}"
            if self.message_body.strip()
            else ""
        )

        return f"""## Commit Context
- Commit SHA: `{self.sha}` ({self.short_sha})
- Author: {self.author_name} <{self.author_email}>
- Date: {self.date}
- Parents: {parents_str}
- Merge Commit: {merge_str}
- Subject: {self.message_subject}{extended_body}

### Changes Summary
{self.diff_summary()}

### Changed Files
{files_block}

### Code Diff
```diff
{diff_content}
```
""".strip()


class DevelopmentSessionReport(BaseModel):
    """Pydantic V2 schema for content/analysis/<sha>.json reports.

    Conforms strictly to PROJECT.md § Interface Contracts and
    test/ai-content/harness/schema-validator.js validation invariants:
    - commit_sha: 40-character hexadecimal string
    - timestamp: ISO-8601 string
    - summary: non-empty string (>10 chars)
    - architecture_impact: non-empty string (>10 chars)
    - key_takeaways: array of non-empty strings (>= 1 item)
    - changed_components: array of strings
    - suggested_article_title: non-empty string
    - suggested_article_slug: valid kebab-case slug
    """

    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="forbid",
    )

    commit_sha: str = Field(
        ...,
        description="Canonical 40-character hexadecimal commit SHA",
    )
    timestamp: str = Field(
        ...,
        description="ISO-8601 formatted timestamp string",
    )
    summary: str = Field(
        ...,
        min_length=11,
        description="Executive summary of commit changes (minimum 11 characters)",
    )
    architecture_impact: str = Field(
        ...,
        min_length=11,
        description="Architectural impact assessment (minimum 11 characters)",
    )
    key_takeaways: List[str] = Field(
        ...,
        min_length=1,
        description="List of key technical takeaways (at least 1 item)",
    )
    changed_components: List[str] = Field(
        default_factory=list,
        description="List of system components or directories modified",
    )
    suggested_article_title: str = Field(
        ...,
        min_length=1,
        description="Suggested technical article title",
    )
    suggested_article_slug: str = Field(
        ...,
        description="Valid kebab-case URL/file slug",
    )

    @field_validator("commit_sha")
    @classmethod
    def validate_commit_sha(cls, v: str) -> str:
        cleaned = v.strip().lower()
        if not SHA_40_REGEX.match(cleaned):
            raise ValueError(
                f"commit_sha must be a 40-character hexadecimal string, got '{v}'"
            )
        return cleaned

    @field_validator("timestamp")
    @classmethod
    def validate_timestamp(cls, v: str) -> str:
        cleaned = v.strip()
        if not ISO_8601_REGEX.match(cleaned):
            try:
                dt = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
                normalized = dt.isoformat()
                if not ISO_8601_REGEX.match(normalized):
                    raise ValueError
                return cleaned
            except Exception:
                raise ValueError(
                    f"timestamp must be a valid ISO-8601 formatted date string, got '{v}'"
                )
        return cleaned

    @field_validator("summary")
    @classmethod
    def validate_summary(cls, v: str) -> str:
        cleaned = v.strip()
        if len(cleaned) <= 10:
            raise ValueError(
                f"summary must be a descriptive string with >10 characters, got length {len(cleaned)}"
            )
        return cleaned

    @field_validator("architecture_impact")
    @classmethod
    def validate_architecture_impact(cls, v: str) -> str:
        cleaned = v.strip()
        if len(cleaned) <= 10:
            raise ValueError(
                f"architecture_impact must be descriptive with >10 characters, got length {len(cleaned)}"
            )
        return cleaned

    @field_validator("key_takeaways")
    @classmethod
    def validate_key_takeaways(cls, v: List[str]) -> List[str]:
        if not v or len(v) == 0:
            raise ValueError("key_takeaways must contain at least 1 item")
        cleaned_items: List[str] = []
        for i, item in enumerate(v):
            if not isinstance(item, str) or not item.strip():
                raise ValueError(f"key_takeaways[{i}] must be a non-empty string")
            cleaned_items.append(item.strip())
        return cleaned_items

    @field_validator("suggested_article_title")
    @classmethod
    def validate_suggested_article_title(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("suggested_article_title must be a non-empty string")
        return cleaned

    @field_validator("suggested_article_slug")
    @classmethod
    def validate_suggested_article_slug(cls, v: str) -> str:
        cleaned = v.strip()
        if not SLUG_REGEX.match(cleaned):
            raise ValueError(
                f"suggested_article_slug must be valid kebab-case (e.g. 'feature-name-123'), got '{v}'"
            )
        return cleaned

    @classmethod
    def create_slug(cls, text: str) -> str:
        """Generate a valid kebab-case slug from arbitrary text string."""
        return slugify(text)

    def to_json_file(
        self,
        filepath: Union[str, Path],
        atomic: bool = True,
        indent: int = 2,
    ) -> Path:
        """Serialize and save report to a JSON file.

        When atomic=True, writes first to a temporary file in the same directory
        and performs an atomic rename/replace (POSIX and Windows NTFS compatible),
        preventing file corruption during concurrent reads or sudden interruptions.

        Args:
            filepath: Destination file path.
            atomic: Whether to write atomically via temporary file and replace.
            indent: Indentation spaces for JSON formatting.

        Returns:
            Resolved destination Path.
        """
        dest_path = Path(filepath).resolve()
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        json_content = self.model_dump_json(indent=indent)

        if atomic:
            temp_filename = f"{dest_path.name}.tmp.{os.getpid()}_{time.time_ns()}"
            temp_path = dest_path.parent / temp_filename
            try:
                temp_path.write_text(json_content, encoding="utf-8")
                temp_path.replace(dest_path)
            except Exception:
                if temp_path.exists():
                    try:
                        temp_path.unlink()
                    except OSError:
                        pass
                raise
        else:
            dest_path.write_text(json_content, encoding="utf-8")

        return dest_path

    @classmethod
    def from_json_file(cls, filepath: Union[str, Path]) -> "DevelopmentSessionReport":
        """Load and validate a DevelopmentSessionReport from a JSON file.

        Args:
            filepath: Path to the JSON file.

        Returns:
            Validated DevelopmentSessionReport instance.

        Raises:
            FileNotFoundError: If the file does not exist.
            ValueError / ValidationError: If the file content violates schema.
        """
        path = Path(filepath).resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Report file not found: {path}")
        content = path.read_text(encoding="utf-8")
        return cls.model_validate_json(content)

    @classmethod
    def export_json_schema(cls) -> Dict[str, Any]:
        """Export the Pydantic V2 JSON Schema dictionary."""
        return cls.model_json_schema()
