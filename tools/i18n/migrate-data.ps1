<#
    One-time data migration for the English fork.

    Copies the plugin's petal storage from the original plugin id to the
    English fork id so settings, AI configuration, scheduled events, task
    metadata/cache and the activation state carry over.

    Run it once before enabling the English plugin for the first time.
    The source folder is left untouched (rollback = delete the target).

    Usage:
      powershell -NoProfile -ExecutionPolicy Bypass -File tools/i18n/migrate-data.ps1
      powershell ... -DataRoot '<workspace data dir>' -From siyuan-plugin-task-horizon -To siyuan-plugin-task-horizon-en [-Force]

    Pass -DataRoot, or set SIYUAN_DATA_DIR once in the environment.
#>
param(
    [string]$DataRoot = '',
    [string]$From = 'siyuan-plugin-task-horizon',
    [string]$To = 'siyuan-plugin-task-horizon-en',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
if (-not $DataRoot) {
    if ($env:SIYUAN_DATA_DIR) { $DataRoot = $env:SIYUAN_DATA_DIR }
    else { throw "Data directory unknown. Pass -DataRoot '<workspace data dir>', or set SIYUAN_DATA_DIR." }
}
$src = Join-Path $DataRoot "storage\petal\$From"
$dst = Join-Path $DataRoot "storage\petal\$To"

if (-not (Test-Path -LiteralPath $src)) {
    Write-Host "source petal folder not found: $src" -ForegroundColor Yellow
    Write-Host "nothing to migrate (a fresh install starts with defaults)." -ForegroundColor Yellow
    exit 0
}
if ((Test-Path -LiteralPath $dst) -and -not $Force) {
    throw "destination already exists: $dst (close SiYuan and use -Force to merge/overwrite)"
}

Write-Host "==> copying $src" -ForegroundColor Cyan
Write-Host "            -> $dst" -ForegroundColor Cyan
robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP | Out-Null
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "robocopy failed with exit code $rc" }

Write-Host "==> migrated (the original folder was left untouched)." -ForegroundColor Green
Write-Host "Next: in SiYuan, disable/uninstall the original 'Task Horizon' plugin and enable 'Task Horizon (English)'." -ForegroundColor Yellow
