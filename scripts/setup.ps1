# One-time setup on a fresh clone (PLAN.md section 8, Phase 5): installs the development packages,
# builds the compiled CLI into dist, runs the card coverage check and prints the versions in use.
# Usage (PowerShell 5 or 7, from the repository folder):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1
# Needs Node.js 22 or newer (node and npm on PATH). Exit code 0 when every step worked, 1 otherwise.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { [Console]::Error.WriteLine('node was not found on PATH: install Node.js 22 or newer from https://nodejs.org and open a new PowerShell window'); exit 1 }
  $major = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
  if ($major -lt 22) { [Console]::Error.WriteLine("Node.js $(& node --version) is too old: this project needs 22 or newer"); exit 1 }

  # npm and node write progress to stderr; with Stop, PowerShell 5 would treat that as an error.
  $ErrorActionPreference = 'Continue'
  Write-Host '== 1 of 4: npm install'
  & npm install
  if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine('npm install failed'); exit 1 }

  Write-Host '== 2 of 4: npm run build (TypeScript to dist)'
  & npm run build
  if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine('npm run build failed'); exit 1 }
  $built = (Get-ChildItem (Join-Path $root 'dist') -Recurse -Filter '*.js').Count
  Write-Host "built $built JavaScript files into dist"
  if ($built -eq 0) { [Console]::Error.WriteLine('the build produced no files'); exit 1 }

  Write-Host '== 3 of 4: comprehensive rules text (docs/CR.txt, downloaded from wizards.com)'
  & node scriptsetch-cr.mjs
  if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine('the comprehensive rules download failed (see docs/RULES-NOTES.md)'); exit 1 }

  Write-Host '== 4 of 4: npm run check:cards (card definitions against the decklists)'
  & npm run check:cards
  if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine('check:cards found a gap'); exit 1 }

  $tsc = (& node (Join-Path $root 'node_modules\typescript\bin\tsc') --version).Trim()
  $vitest = (& node -p "require('./node_modules/vitest/package.json').version").Trim()
  $tsx = (& node -p "require('./node_modules/tsx/package.json').version").Trim()
  $project = (& node -p "require('./package.json').version").Trim()
  Write-Host ''
  Write-Host 'versions:'
  Write-Host "  node       $(& node --version)"
  Write-Host "  npm        $(& npm --version)"
  Write-Host "  typescript $tsc"
  Write-Host "  vitest     $vitest"
  Write-Host "  tsx        $tsx"
  Write-Host "  project    $project"
  Write-Host "  PowerShell $($PSVersionTable.PSVersion)"
  Write-Host ''
  Write-Host 'setup done. Try: .\scripts\hand.ps1 --help   (or: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\hand.ps1 --help)'
  exit 0
} finally {
  Pop-Location
}
