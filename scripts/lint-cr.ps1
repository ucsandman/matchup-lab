# Lint CR citations in src/**/*.ts against docs/CR.txt. Exit code is the lint's.
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'lint-cr.mjs') @args
exit $LASTEXITCODE
