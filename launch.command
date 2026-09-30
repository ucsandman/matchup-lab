#!/bin/bash
# Matchup Lab for macOS: double-click this file in Finder to set up (first time only) and open the web page.
# If macOS says it cannot be opened: right-click it, choose Open, then click Open.
# If it opens in a text editor instead, run once in Terminal: chmod +x launch.command
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then
  python3 launch.py "$@"
  exit $?
fi
echo
echo "Matchup Lab needs Python 3.8 or newer, and it was not found on this Mac."
echo "  1. Your browser will now open https://www.python.org/downloads/"
echo "  2. Download the macOS installer and run it."
echo "  3. When it finishes, double-click launch.command again."
echo
open "https://www.python.org/downloads/"
read -r -p "Press Enter to close"
exit 1
