# Computer player against computer player, N games (PLAN.md section 8, Phases 2 and 5).
# Usage: scripts\match.ps1 --a greedy|random|mcts --b greedy|random|mcts [--games N] [--seed S] [--workers W]
#        [--mode validated|uct] [--play A|B|alternate|random] [--json]
#        scripts\match.ps1 --help
# Runs the compiled CLI (node dist/cli/index.js match) and passes every argument through unchanged. It builds dist
# first (the TypeScript compiler from node_modules) when dist is missing or older than a file under src.
# Exit code: the CLI's (0 done, 2 bad input, 1 the tool failed).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cli = Join-Path $root 'dist\cli\index.js'
$tsc = Join-Path $root 'node_modules\typescript\bin\tsc'
if (-not (Test-Path $tsc)) { [Console]::Error.WriteLine('node_modules is missing: run scripts\setup.ps1 (or npm install) first'); exit 2 }
$newest = Get-ChildItem (Join-Path $root 'src') -Recurse -Filter '*.ts' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not (Test-Path $cli) -or $newest.LastWriteTime -gt (Get-Item $cli).LastWriteTime) {
  [Console]::Error.WriteLine('building dist (the source is newer than the compiled CLI) ...')
  & node $tsc -p (Join-Path $root 'tsconfig.json')
  if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine('build failed; run npm run build to see why'); exit 1 }
}
# Progress lines go to stderr; with Stop, PowerShell 5 would turn them into errors when stderr is redirected.
$ErrorActionPreference = 'Continue'
& node $cli match @args
exit $LASTEXITCODE
