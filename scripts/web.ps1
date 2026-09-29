# Local web UI (PLAN.md section 8, Phase 5; docs/WEB-UI.md): builds dist/ when it is missing or older
# than src/, then starts the server on 127.0.0.1 and prints the URL. Ctrl+C stops it.
# Usage: scripts/web.ps1 [--port 3456]
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$server = Join-Path $root 'dist/web/server.js'
$stale = -not (Test-Path $server)
if (-not $stale) {
  $built = (Get-Item $server).LastWriteTime
  $newer = Get-ChildItem (Join-Path $root 'src') -Recurse -Filter *.ts | Where-Object { $_.LastWriteTime -gt $built } | Select-Object -First 1
  $stale = $null -ne $newer
}
if ($stale) {
  Write-Host 'Building dist/ (first start or source changed)...'
  & node (Join-Path $root 'node_modules/typescript/bin/tsc') -p (Join-Path $root 'tsconfig.json')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& node $server @args
exit $LASTEXITCODE
