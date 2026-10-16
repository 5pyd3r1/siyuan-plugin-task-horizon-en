<#
    Deploys a build into the SiYuan workspace plugin directory.

    Steps:
      1. node tools/i18n/stage.js --lang <en|zh>  (build + translate + syntax verify)
      2. back up the current installed plugin folder (zip, timestamped)
      3. mirror the staged tree into the plugin folder
      4. remove src/task-horizon if present (it would override task.js)

    Usage:
      pwsh -File tools/i18n/deploy.ps1                    # English build (default)
      pwsh -File tools/i18n/deploy.ps1 -Lang zh           # pristine Chinese build
      pwsh -File tools/i18n/deploy.ps1 -StageOnly         # build stage only
      pwsh -File tools/i18n/deploy.ps1 -NoBackup          # skip the zip backup
#>
param(
    [ValidateSet('en', 'zh')][string]$Lang = 'en',
    [string]$SiYuanPluginDir = 'X:\siyuan\data\plugins\siyuan-plugin-task-horizon',
    [switch]$StageOnly,
    [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$stage = Join-Path $repo 'output\i18n\stage'
$backupDir = Join-Path $repo 'output\i18n\backups'

Write-Host "==> staging (build + verify) [language: $Lang]" -ForegroundColor Cyan
& node (Join-Path $repo 'tools\i18n\stage.js') --lang $Lang
if ($LASTEXITCODE -ne 0) { throw "stage.js failed with exit code $LASTEXITCODE" }
if (-not (Test-Path (Join-Path $stage 'task.js'))) { throw "stage is missing task.js" }

if ($StageOnly) {
    Write-Host "stage only; skipping deploy. Stage: $stage" -ForegroundColor Yellow
    exit 0
}

if (-not (Test-Path -LiteralPath $SiYuanPluginDir)) {
    throw "SiYuan plugin dir not found: $SiYuanPluginDir"
}

if (-not $NoBackup) {
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupZip = Join-Path $backupDir "installed-$stamp.zip"
    Write-Host "==> backing up current install to $backupZip" -ForegroundColor Cyan
    Compress-Archive -Path (Join-Path $SiYuanPluginDir '*') -DestinationPath $backupZip -CompressionLevel Optimal
}

$stageVersion = (Get-Content -Raw -Encoding UTF8 (Join-Path $stage 'plugin.json') | ConvertFrom-Json).version
Write-Host "==> deploying v$stageVersion to $SiYuanPluginDir" -ForegroundColor Cyan
robocopy $stage $SiYuanPluginDir /E /NFL /NDL /NJH /NJS /NP | Out-Null
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "robocopy failed with exit code $rc" }

$devSources = Join-Path $SiYuanPluginDir 'src\task-horizon'
if (Test-Path -LiteralPath $devSources) {
    Remove-Item -LiteralPath $devSources -Recurse -Force
    Write-Host "removed leftover src\task-horizon (dev-mode overrides task.js)" -ForegroundColor Yellow
}

Write-Host "==> deployed (language: $Lang)." -ForegroundColor Green
Write-Host "Reload the plugin in SiYuan (toggle it off/on) to pick up the new build."
