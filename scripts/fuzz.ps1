# Random-vs-random fuzzer with invariants 1-8 (PLAN.md section 7). Usage: scripts/fuzz.ps1 [--games N] [--seed S] [--pool test|extended|decks|sideboard]
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
& node --import tsx (Join-Path $root 'src/tools/fuzz.ts') @args
exit $LASTEXITCODE
