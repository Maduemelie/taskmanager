"""CLI Module Execution Entry Point.

Enables execution via:
    python -m ai_content [COMMAND] [ARGS]
"""

import sys
from ai_content.cli import cli

if __name__ == "__main__":
    sys.exit(cli() or 0)
