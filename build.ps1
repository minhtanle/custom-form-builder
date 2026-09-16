# ============================================================
# build.ps1 - Build production bundle for Custom Dynamic Form
# ------------------------------------------------------------
# Problem: Laragon puts node v20.11.0 first on PATH by default,
# but the build needs node v22+ (vite/rolldown requires
# `node:util.styleText`). This script PREPENDS node v22 to PATH
# so npm uses the correct version.
#
# Usage:
#   .\build.ps1            # build engine lib (dist/custom-dynamic-form.js)
#   .\build.ps1 builder    # build builder app (dist/builder/)
#   .\build.ps1 --watch    # pass through any vite args to the engine build
# ============================================================

param([string]$Script = 'build')

$ErrorActionPreference = 'Stop'

# --- 1. Locate a node v22 install (tried in order) ---
$candidates = @(
    'C:\laragon\bin\nodejs\node-v22.21.0-win-x64',
    'C:\laragon\bin\nodejs\node-v22.20.0-win-x64',
    'C:\laragon\bin\nodejs\node-v22.19.0-win-x64',
    'C:\laragon\bin\nodejs\node-v22.0.0-win-x64'
)

$nodeDir = $null
foreach ($d in $candidates) {
    if (Test-Path (Join-Path $d 'node.exe')) { $nodeDir = $d; break }
}

if (-not $nodeDir) {
    # Fallback: scan laragon nodejs folder for any node-v22.*
    $nodeRoot = 'C:\laragon\bin\nodejs'
    if (Test-Path $nodeRoot) {
        $nodeDir = Get-ChildItem $nodeRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match 'node-v22\.' } |
            Sort-Object Name -Descending |
            Select-Object -First 1 -ExpandProperty FullName
    }
}

if (-not $nodeDir) {
    Write-Error "No node v22 found. Install via Laragon > Menu > Node > Version (v22.21.0)."
}

# --- 2. Check real version + prepend to PATH ---
$env:Path = "$nodeDir;$env:Path"
$ver = & (Join-Path $nodeDir 'node.exe') -v
Write-Host "[build] Node: $ver ($nodeDir)" -ForegroundColor Cyan

if ($ver -notmatch '^v22\.' -and $ver -notmatch '^v23\.') {
    Write-Warning "Node is $ver - build expects v22+. Attempting anyway..."
}

# --- 3. Run npm build (pass through extra args) ---
$npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $npmCli)) {
    $npmCli = 'npm'   # fallback to PATH npm (only if default node is already v22)
}

if ($args -contains '--watch' -or $args -contains '-w') {
    $npmArgs = @('run', $Script) + $args
} else {
    $npmArgs = @('run', $Script) + $args
}
& (Join-Path $nodeDir 'node.exe') $npmCli @npmArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed (exit $LASTEXITCODE)."
} else {
    Write-Host "[build] Done. Bundle: dist/custom-dynamic-form.js" -ForegroundColor Green
}
