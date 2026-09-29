# Benchmark: games/sec/core, median of per-block rates with its 95 percent order-statistic interval (PLAN.md section 7). Usage: scripts/bench.ps1 [--games N] [--runs R] [--block B] [--pool test|extended|decks|sideboard]
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
& node --import tsx (Join-Path $root 'src/tools/bench.ts') @args
exit $LASTEXITCODE
