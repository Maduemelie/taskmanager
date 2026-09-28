"""Git Context Collector for AI Development Content Generator.

Extracts commit metadata, file changes, statuses, additions/deletions,
and unified diffs without shell interpolation, handling root commits,
merge commits, detached HEAD, empty commits, and large diff truncation.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from ai_content.config import REPO_ROOT
from ai_content.models import FileChangeDetail, GitCommitContext

# Universal Git constant for an empty tree (valid across all Git repositories)
EMPTY_TREE_SHA: str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"


class GitError(RuntimeError):
    """Base exception for Git operations in ai_content."""
    pass


class GitCommitNotFoundError(GitError):
    """Raised when a specified commit ref cannot be resolved or does not exist."""
    pass


def run_git_command(
    args: Sequence[str],
    cwd: Optional[Path] = None,
    timeout: float = 30.0,
    check: bool = True,
) -> str:
    """Execute a git command securely without shell invocation.

    Args:
        args: Sequence of command arguments excluding 'git'.
        cwd: Working directory (defaults to REPO_ROOT).
        timeout: Maximum execution time in seconds.
        check: If True, raise GitError on non-zero exit code.

    Returns:
        Captured stdout as a string.

    Raises:
        GitError: If command fails or git executable is missing.
    """
    work_dir = str(cwd or REPO_ROOT)
    cmd = ["git", "--no-pager", *args]

    env = dict(os.environ)
    env.pop("GIT_INDEX_FILE", None)
    env["GIT_PAGER"] = "cat"
    env["PAGER"] = "cat"

    try:
        proc = subprocess.run(
            cmd,
            cwd=work_dir,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=False,
            timeout=timeout,
        )
        if check and proc.returncode != 0:
            err_msg = proc.stderr.strip() if proc.stderr else f"Exit code {proc.returncode}"
            raise GitError(f"Git command '{' '.join(cmd)}' failed: {err_msg}")
        return proc.stdout
    except subprocess.TimeoutExpired as exc:
        raise GitError(f"Git command '{' '.join(cmd)}' timed out after {timeout}s") from exc
    except FileNotFoundError as exc:
        raise GitError("Git executable 'git' not found in system PATH") from exc


def resolve_commit_sha(
    commit_ref: str = "HEAD",
    repo_root: Optional[Path] = None,
    verify_exists: bool = False,
) -> str:
    """Resolve a git reference to a canonical 40-character hexadecimal SHA.

    Args:
        commit_ref: Git ref (e.g. 'HEAD', tag, branch, short SHA, or 40-char SHA).
        repo_root: Path to repository root.
        verify_exists: If True, verifies object existence in Git database.

    Returns:
        40-character lowercase hexadecimal SHA string.

    Raises:
        GitCommitNotFoundError: If commit ref cannot be resolved or does not exist.
    """
    ref = (commit_ref or "HEAD").strip()
    if not ref:
        raise GitCommitNotFoundError("Commit reference string cannot be empty.")
    root = repo_root or REPO_ROOT

    # Fast path: already a 40-character hex string
    if len(ref) == 40 and all(c in "0123456789abcdefABCDEF" for c in ref):
        canonical_sha = ref.lower()
        if not verify_exists:
            return canonical_sha
        # If verify_exists is requested, verify with git cat-file
        try:
            run_git_command(["cat-file", "-e", f"{canonical_sha}^{{commit}}"], cwd=root)
            return canonical_sha
        except GitError as exc:
            raise GitCommitNotFoundError(f"Commit SHA does not exist in repository: '{ref}'") from exc

    try:
        stdout = run_git_command(["rev-parse", "--verify", f"{ref}^{{commit}}"], cwd=root)
        sha = stdout.strip().lower()
        if len(sha) == 40 and all(c in "0123456789abcdef" for c in sha):
            return sha
        raise GitCommitNotFoundError(f"Invalid resolved commit SHA for ref '{ref}': '{sha}'")
    except GitError:
        # Fallback without ^{commit}
        try:
            stdout = run_git_command(["rev-parse", "--verify", ref], cwd=root)
            sha = stdout.strip().lower()
            if len(sha) == 40 and all(c in "0123456789abcdef" for c in sha):
                # Ensure object is indeed a commit
                if verify_exists:
                    run_git_command(["cat-file", "-e", f"{sha}^{{commit}}"], cwd=root)
                return sha
            raise GitCommitNotFoundError(f"Invalid resolved commit SHA for ref '{ref}': '{sha}'")
        except GitError as exc:
            raise GitCommitNotFoundError(f"Cannot resolve commit reference '{ref}': {exc}") from exc


def get_commit_metadata(sha: str, repo_root: Optional[Path] = None) -> Dict[str, Any]:
    """Extract commit metadata using NUL-delimited git log format."""
    root = repo_root or REPO_ROOT
    format_str = "%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%s%x00%b"

    stdout = run_git_command(["log", "-1", f"--format={format_str}", sha], cwd=root)

    # Strip trailing newline added by git log format
    if stdout.endswith("\n"):
        stdout = stdout[:-1]
    if stdout.endswith("\r"):
        stdout = stdout[:-1]

    tokens = stdout.split("\x00", 7)
    if len(tokens) < 8:
        raise GitError(f"Unexpected git log format output for {sha}: expected 8 tokens, got {len(tokens)}")

    commit_sha = tokens[0].strip().lower()
    short_sha = tokens[1].strip().lower()
    author_name = tokens[2].strip()
    author_email = tokens[3].strip()
    commit_date = tokens[4].strip()
    parents_raw = tokens[5].strip()
    subject = tokens[6].strip()
    body = tokens[7].strip()

    parent_shas = [p.lower() for p in parents_raw.split() if p.strip()]
    is_merge = len(parent_shas) > 1

    return {
        "sha": commit_sha,
        "short_sha": short_sha,
        "author_name": author_name,
        "author_email": author_email,
        "date": commit_date,
        "parent_shas": parent_shas,
        "is_merge": is_merge,
        "message_subject": subject,
        "message_body": body,
    }


def unquote_git_path(path_str: str) -> str:
    """Unquote git C-quoted pathname if enclosed in quotes."""
    path_str = path_str.strip()
    if path_str.startswith('"') and path_str.endswith('"') and len(path_str) >= 2:
        try:
            return (
                path_str[1:-1]
                .encode("utf-8")
                .decode("unicode_escape")
                .encode("latin1")
                .decode("utf-8")
            )
        except Exception:
            return path_str[1:-1]
    return path_str


def extract_new_path_from_numstat(path_str: str) -> str:
    """Extract new path from numstat path string that may contain rename arrow syntax."""
    # Pattern 1: braced rename "dir/{old => new}/file.ext" or "{old => new}"
    if "{" in path_str and " => " in path_str and "}" in path_str:
        return re.sub(r"\{.*? => (.*?)\}", r"\1", path_str).replace("//", "/")
    # Pattern 2: unbraced rename "old => new"
    if " => " in path_str:
        return path_str.split(" => ")[-1].strip()
    return path_str.strip()


def normalize_status(raw_status: str) -> str:
    """Normalize git raw status letter to one of 'A', 'M', 'D', 'R', 'C', 'T', 'U'."""
    code = raw_status[0].upper() if raw_status else "M"
    if code in ("A", "M", "D", "R", "C", "T", "U"):
        return code
    return "M"


def parse_name_status_output(output: str) -> List[Tuple[str, str, Optional[str]]]:
    """Parse output of git diff-tree --name-status into (status, filename, old_filename)."""
    results: List[Tuple[str, str, Optional[str]]] = []
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t")
        if not parts:
            continue
        raw_status = parts[0].strip()
        status_code = raw_status[0].upper() if raw_status else "M"

        if status_code in ("R", "C") and len(parts) >= 3:
            old_path = unquote_git_path(parts[1])
            new_path = unquote_git_path(parts[2])
            results.append((normalize_status(status_code), new_path, old_path))
        elif len(parts) >= 2:
            path = unquote_git_path(parts[1])
            results.append((normalize_status(status_code), path, None))
    return results


def parse_numstat_output(output: str) -> List[Tuple[str, int, int, bool]]:
    """Parse output of git diff-tree --numstat into (filename, additions, deletions, is_binary)."""
    results: List[Tuple[str, int, int, bool]] = []
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t", 2)
        if len(parts) < 3:
            continue
        add_str = parts[0].strip()
        del_str = parts[1].strip()
        raw_path = parts[2].strip()

        is_binary = (add_str == "-" or del_str == "-")
        additions = 0 if is_binary else int(add_str)
        deletions = 0 if is_binary else int(del_str)

        clean_path = extract_new_path_from_numstat(raw_path)
        clean_path = unquote_git_path(clean_path)
        results.append((clean_path, additions, deletions, is_binary))
    return results


def get_changed_files(sha: str, repo_root: Optional[Path] = None) -> List[FileChangeDetail]:
    """Extract list of changed files with status and additions/deletions.

    Uses dual-pass diff-tree query:
    1. --name-status for status code and target filenames.
    2. --numstat for line additions/deletions count and binary detection.
    """
    root = repo_root or REPO_ROOT

    # 1. Status query
    res_status = run_git_command(
        ["diff-tree", "--root", "-r", "--no-commit-id", "-m", "--first-parent", "-M", "--name-status", sha],
        cwd=root,
    )
    status_list = parse_name_status_output(res_status)

    # 2. Numstat query
    res_numstat = run_git_command(
        ["diff-tree", "--root", "-r", "--no-commit-id", "-m", "--first-parent", "-M", "--numstat", sha],
        cwd=root,
    )
    numstat_list = parse_numstat_output(res_numstat)

    stat_map: Dict[str, Tuple[int, int, bool]] = {
        item[0]: (item[1], item[2], item[3]) for item in numstat_list
    }

    file_details: List[FileChangeDetail] = []
    for idx, (status, filename, old_filename) in enumerate(status_list):
        if filename in stat_map:
            adds, dels, is_bin = stat_map[filename]
        elif idx < len(numstat_list):
            adds, dels, is_bin = numstat_list[idx][1], numstat_list[idx][2], numstat_list[idx][3]
        else:
            adds, dels, is_bin = 0, 0, False

        file_details.append(
            FileChangeDetail(
                filename=filename,
                status=status,
                additions=adds,
                deletions=dels,
                old_filename=old_filename,
                is_binary=is_bin,
            )
        )
    return file_details


def extract_diff(
    sha: str,
    parents: Sequence[str],
    repo_root: Optional[Path] = None,
) -> str:
    """Extract raw unified diff for standard, root, or merge commits.

    Edge cases handled:
    - Root commit: diffs against universal empty tree hash.
    - Merge commit: diffs against first parent (parents[0]) with merge context banner.
    - Standard commit: diffs against single parent.
    """
    root = repo_root or REPO_ROOT
    is_root = len(parents) == 0
    is_merge = len(parents) >= 2

    if is_root:
        # Diff against universal empty tree hash
        diff_out = run_git_command(
            ["diff", "--no-color", "-M", EMPTY_TREE_SHA, sha],
            cwd=root,
            check=False,
        )
        if not diff_out.strip():
            # Fallback to diff-tree --root -p
            diff_out = run_git_command(
                ["diff-tree", "--root", "-p", "-r", "--no-commit-id", sha],
                cwd=root,
                check=False,
            )
        return diff_out.strip()

    if is_merge:
        # First-parent diff captures all changes introduced into target branch
        diff_out = run_git_command(
            ["diff", "--no-color", "-M", parents[0], sha],
            cwd=root,
            check=False,
        )
        merge_header = (
            "--- [MERGE COMMIT CONTEXT] ---\n"
            f"Target Branch Parent (Parent 1): {parents[0]}\n"
            f"Merged Branch Parents: {', '.join(parents[1:])}\n"
            "Mode: First-Parent Cumulative Diff (showing changes merged into target branch)\n"
            "------------------------------\n"
        )
        clean_diff = diff_out.strip()
        return (merge_header + clean_diff) if clean_diff else merge_header.strip()

    # Standard single parent commit
    diff_out = run_git_command(
        ["diff", "--no-color", "-M", parents[0], sha],
        cwd=root,
        check=False,
    )
    return diff_out.strip()


def truncate_diff(
    diff: str,
    changed_files: Sequence[FileChangeDetail],
    max_chars: int = 30000,
    max_lines: int = 500,
) -> Tuple[str, bool]:
    """Cleanly truncate diff at line boundary if exceeding char or line limits.

    Args:
        diff: Full unified diff text.
        changed_files: Complete list of FileChangeDetail instances.
        max_chars: Maximum character limit.
        max_lines: Maximum line limit.

    Returns:
        Tuple of (truncated_diff_string, is_truncated_bool).
    """
    if not diff:
        return "", False

    normalized = diff.replace("\r\n", "\n")
    lines = normalized.split("\n")
    total_chars = len(normalized)
    total_lines = len(lines)

    if total_chars <= max_chars and total_lines <= max_lines:
        return normalized, False

    accumulated_lines: List[str] = []
    accumulated_chars = 0

    for idx, line in enumerate(lines):
        line_cost = len(line) + 1  # include newline
        if idx >= max_lines or (accumulated_chars + line_cost) > max_chars:
            break
        accumulated_lines.append(line)
        accumulated_chars += line_cost

    shown_lines_count = len(accumulated_lines)
    omitted_lines_count = total_lines - shown_lines_count
    shown_chars_count = accumulated_chars
    omitted_chars_count = total_chars - shown_chars_count

    # Determine which files were shown in the truncated hunk
    visible_files: Set[str] = set()
    for line in accumulated_lines:
        if line.startswith("diff --git a/"):
            parts = line.split(" b/", 1)
            if len(parts) == 2:
                visible_files.add(parts[1].strip())

    unshown = [f for f in changed_files if f.filename not in visible_files]

    banner = [
        "",
        "=" * 78,
        "  [DIFF TRUNCATED: Exceeded LLM Context Threshold]",
        f"  Thresholds: max {max_chars:,} characters / max {max_lines:,} lines",
        f"  Total Diff Size: {total_chars:,} characters, {total_lines:,} lines across {len(changed_files)} file(s)",
        f"  Shown:           {shown_chars_count:,} characters, {shown_lines_count:,} lines ({len(visible_files)} file(s) visible)",
        f"  Omitted:         {omitted_chars_count:,} characters, {omitted_lines_count:,} lines",
    ]
    if unshown:
        banner.append(f"  Remaining changed file(s) omitted from diff:")
        for f in unshown[:15]:
            banner.append(f"    - [{f.status_code}] {f.filename} (+{f.additions}, -{f.deletions})")
        if len(unshown) > 15:
            banner.append(f"    ... and {len(unshown) - 15} additional files.")
    banner.append("=" * 78)

    truncated_result = "\n".join(accumulated_lines) + "\n" + "\n".join(banner)
    return truncated_result, True


def collect_git_context(
    commit_ref: str = "HEAD",
    max_diff_chars: int = 30000,
    repo_root: Optional[Path] = None,
    max_diff_lines: int = 500,
) -> GitCommitContext:
    """Extract complete Git commit context into structured domain models.

    Args:
        commit_ref: Git reference (HEAD, branch, tag, short SHA, or 40-char SHA).
        max_diff_chars: Maximum diff character threshold before truncation.
        repo_root: Path to git repository (defaults to REPO_ROOT).
        max_diff_lines: Maximum diff line threshold before truncation.

    Returns:
        GitCommitContext instance.

    Raises:
        GitCommitNotFoundError: If commit ref does not exist in repository.
        GitError: If git operations fail.
    """
    root = repo_root or REPO_ROOT

    # 1. Canonical 40-char SHA resolution with object existence check
    sha = resolve_commit_sha(commit_ref, repo_root=root, verify_exists=True)

    # 2. Extract commit metadata via NUL-delimited git log
    meta = get_commit_metadata(sha, repo_root=root)

    # 3. Extract changed files via dual-pass diff-tree
    changed_files = get_changed_files(sha, repo_root=root)

    # 4. Extract diff handling root/merge/empty edge cases
    raw_diff = extract_diff(sha, meta["parent_shas"], repo_root=root)

    # 5. Clean line-boundary diff truncation
    processed_diff, _ = truncate_diff(
        raw_diff,
        changed_files,
        max_chars=max_diff_chars,
        max_lines=max_diff_lines,
    )

    return GitCommitContext(
        sha=meta["sha"],
        short_sha=meta["short_sha"],
        author_name=meta["author_name"],
        author_email=meta["author_email"],
        date=meta["date"],
        message_subject=meta["message_subject"],
        message_body=meta["message_body"],
        changed_files=changed_files,
        diff=processed_diff,
        is_merge=meta["is_merge"],
        parent_shas=meta["parent_shas"],
    )
