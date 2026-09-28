"""Configuration module for AI Content Generator.

Handles dynamic repository path resolution, environment variable loading
from the repository root .env file, directory structure definition, and
Google Gemini model settings.
"""

import os
from pathlib import Path
from typing import Tuple

# Safe optional import of python-dotenv
try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[assignment]

# 1. Dynamically determine REPO_ROOT
# config.py is located at: <REPO_ROOT>/ai_content/config.py
# parent -> <REPO_ROOT>/ai_content
# parent.parent -> <REPO_ROOT>
REPO_ROOT: Path = Path(__file__).resolve().parent.parent

# 2. Load REPO_ROOT / ".env" with override=True
ENV_PATH: Path = REPO_ROOT / ".env"
if load_dotenv is not None and ENV_PATH.is_file():
    load_dotenv(dotenv_path=ENV_PATH, override=True)

# 3. Directory Constants
CONTENT_DIR: Path = REPO_ROOT / "content"
ANALYSIS_DIR: Path = CONTENT_DIR / "analysis"
ARTICLES_DIR: Path = CONTENT_DIR / "articles"
JOURNAL_DIR: Path = CONTENT_DIR / "journal"
SOCIAL_DIR: Path = CONTENT_DIR / "social"
LOGS_DIR: Path = CONTENT_DIR / "logs"

# Directory tuple for directory creation and maintenance
ALL_CONTENT_DIRS: Tuple[Path, ...] = (
    CONTENT_DIR,
    ANALYSIS_DIR,
    ARTICLES_DIR,
    JOURNAL_DIR,
    SOCIAL_DIR,
    LOGS_DIR,
)


def ensure_directories() -> None:
    """Create all required content and log directories if they do not exist."""
    for directory in ALL_CONTENT_DIRS:
        directory.mkdir(parents=True, exist_ok=True)


# 4. Gemini Settings
DEFAULT_GEMINI_MODEL: str = "gemini/gemini-2.5-flash"

GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


def is_gemini_configured() -> bool:
    """Return True if a non-empty GEMINI_API_KEY is found in the environment."""
    return bool(GEMINI_API_KEY and GEMINI_API_KEY.strip())


def reload_config() -> None:
    """Reload environment variables from .env file and update module-level settings."""
    global GEMINI_API_KEY, GEMINI_MODEL
    if load_dotenv is not None and ENV_PATH.is_file():
        load_dotenv(dotenv_path=ENV_PATH, override=True)
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
