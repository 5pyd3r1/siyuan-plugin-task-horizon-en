<#
    Deploys a build into the SiYuan workspace plugin directory.

    Steps:
      1. node tools/i18n/stage.js --lang <en|zh> --identity <fork|upstream>
      2. back up the current installed plugin folder (zip, timestamped), if present
      3. mirror the staged tree into the plugin folder (folder name taken from
         the staged plugin.json unless -SiYuanPluginDir is given)
      4. remove src/task-horizon if present (it would override task.js)

    Builds:
      en + fork       English build under the published identity
                      "siyuan-plugin-task-horizon-en" (default; installs next
                      to the original plugin, needs a one-time data migration)
      en + upstream   English build keeping the upstream identity (drop-in
                      replacement of the original plugin folder)
      zh              pristine Chinese build (upstream identity)

    Usage:
      powershell -NoProfile -ExecutionPolicy Bypass -File tools/i18n/deploy.ps1
      powershell ... -Lang en -Identity upstream    # drop-in English build
      powershell ... -Lang zh                      # pristine Chinese build
      powershell ... -StageOnly                    # build stage only
      powershell ... -NoBackup                     # skip the zip backup

    SiYuan locations are user-specific: pass -SiYuanPluginsRoot, or set
    SIYUAN_DATA_DIR / SIYUAN_PLUGINS_ROOT once in the environment.
#>
param(
    [ValidateSet('en', 'zh')][string]$Lang = 'en',
    [ValidateSet('fork', 'upstream')][string]$Identity = 'fork',
    [string]$SiYuanPluginsRoot = '',
    [string]$SiYuanPluginDir = '',
    [switch]$StageOnly,
    [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$stage = Join-Path $repo 'output\i18n\stage'
$backupDir = Join-Path $repo 'output\i18n\backups'

Write-Host "==> staging (build + verify) [language: $Lang, identity: $Identity]" -ForegroundColor Cyan
& node (Join-Path $repo 'tools\i18n\stage.js') --lang $Lang --identity $Identity
if ($LASTEXITCODE -ne 0) { throw "stage.js failed with exit code $LASTEXITCODE" }
if (-not (Test-Path (Join-Path $stage 'task.js'))) { throw "stage is missing task.js" }

$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $stage 'plugin.json') | ConvertFrom-Json

if ($StageOnly) {
    Write-Host "stage only; skipping deploy. Stage: $stage" -ForegroundColor Yellow
    Write-Host "staged plugin: $($manifest.name) v$($manifest.version)" -ForegroundColor Yellow
    exit 0
}

if (-not $SiYuanPluginDir) {
    if (-not $SiYuanPluginsRoot) {
        if ($env:SIYUAN_DATA_DIR) { $SiYuanPluginsRoot = Join-Path $env:SIYUAN_DATA_DIR 'plugins' }
        elseif ($env:SIYUAN_PLUGINS_ROOT) { $SiYuanPluginsRoot = $env:SIYUAN_PLUGINS_ROOT }
        else {
            throw "Plugin location unknown. Pass -SiYuanPluginsRoot '<data>\plugins', or set SIYUAN_DATA_DIR / SIYUAN_PLUGINS_ROOT."
        }
    }
    $SiYuanPluginDir = Join-Path $SiYuanPluginsRoot $manifest.name
}

if (Test-Path -LiteralPath $SiYuanPluginDir) {
    if (-not $NoBackup) {
        New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backupZip = Join-Path $backupDir "$($manifest.name)-$stamp.zip"
        Write-Host "==> backing up current install to $backupZip" -ForegroundColor Cyan
        Compress-Archive -Path (Join-Path $SiYuanPluginDir '*') -DestinationPath $backupZip -CompressionLevel Optimal
    }
} else {
    Write-Host "==> target folder does not exist yet (fresh install): $SiYuanPluginDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $SiYuanPluginDir | Out-Null
}

Write-Host "==> deploying $($manifest.name) v$($manifest.version) to $SiYuanPluginDir" -ForegroundColor Cyan
robocopy $stage $SiYuanPluginDir /E /NFL /NDL /NJH /NJS /NP | Out-Null
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "robocopy failed with exit code $rc" }

$devSources = Join-Path $SiYuanPluginDir 'src\task-horizon'
if (Test-Path -LiteralPath $devSources) {
    Remove-Item -LiteralPath $devSources -Recurse -Force
    Write-Host "removed leftover src\task-horizon (dev-mode overrides task.js)" -ForegroundColor Yellow
}

Write-Host "==> deployed ($($manifest.name), language: $Lang)." -ForegroundColor Green
Write-Host "Reload the plugin in SiYuan (toggle it off/on) to pick up the new build."
if ($manifest.name -eq 'siyuan-plugin-task-horizon-en') {
    Write-Host "First install of the English fork?" -ForegroundColor Yellow
    Write-Host "  1. copy petal data once: powershell -NoProfile -ExecutionPolicy Bypass -File tools/i18n/migrate-data.ps1" -ForegroundColor Yellow
    Write-Host "  2. in SiYuan, disable/uninstall the original 'Task Horizon' plugin" -ForegroundColor Yellow
    Write-Host "  3. restart SiYuan (or refresh plugins) so the new folder is discovered" -ForegroundColor Yellow
}
