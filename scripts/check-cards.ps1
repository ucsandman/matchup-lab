# Card defs vs decklists and decks/oracle.json, plus scenario-test coverage (PLAN.md section 6).
# Prints a coverage table (card, faces, tests) and counts; exit code 1 on any gap.
# Usage: scripts/check-cards.ps1
$ErrorActionPreference = 'Stop'
& node --import tsx (Join-Path $PSScriptRoot 'check-cards.mjs') @args
exit $LASTEXITCODE
