<#
.SYNOPSIS
    Cleans build artifacts, caches, and target folder.
#>

$ErrorActionPreference = "Continue" # Continue on error for clean tasks
# Enhanced encoding compatibility for CI/CD
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Console]::OutputEncoding

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
# Use .Path to get clean string
$ROOT_DIR = (Resolve-Path "$SCRIPT_DIR/../..").Path 

function Write-Header { param($Message) Write-Host "`n=== $Message ===" -ForegroundColor Cyan }
function Write-Step { param($Message) Write-Host "--> $Message" -ForegroundColor Yellow }
function Write-Success { param($Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-ErrorMsg { param($Message) Write-Host "[!!] $Message" -ForegroundColor Red }

# Axelate Cleanup Script (Enhanced)
Write-Header "Axelate - Comprehensive Clean"

# Paths
$DirsToClean = @(
    "$ROOT_DIR/src/dist",
    "$ROOT_DIR/src/node_modules/.cache",
    "$ROOT_DIR/src/node_modules/.vite",
    "$ROOT_DIR/src/.vite",
    "$ROOT_DIR/src-tauri/target",
    "$ROOT_DIR/src-tauri/gen",
    "$ROOT_DIR/build"
)

# Logs and Temp Files
$FilesToClean = @(
    "$ROOT_DIR/src/npm-debug.log*",
    "$ROOT_DIR/src/yarn-debug.log*",
    "$ROOT_DIR/src/yarn-error.log*",
    "$ROOT_DIR/src/*.log",
    "$ROOT_DIR/src-tauri/check_output.txt"
)

# Optional: Deep Clean (Node Modules)
if ($args -contains "--deep") {
    Write-Step "DEEP CLEAN ENABLED: Including node_modules..."
    $DirsToClean += "$ROOT_DIR/src/node_modules"
}

$TotalSize = 0

Write-Step "Cleaning directories..."
foreach ($Dir in $DirsToClean) {
    # Resolve path to handle mix of slashes potentially
    # But string concatenation with / usually works in PS Core/Windows
    if (Test-Path $Dir) {
        try {
            $Size = (Get-ChildItem $Dir -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
            $SizeMB = [math]::Round($Size / 1MB, 2)
            Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "   [x] $($Dir.Replace($ROOT_DIR, '.')) ($SizeMB MB)" -ForegroundColor Green
            $TotalSize += $Size
        }
        catch {
            Write-ErrorMsg "Failed to clean $Dir : $_"
        }
    }
}

Write-Step "Cleaning trace files..."
foreach ($FilePattern in $FilesToClean) {
    if (Test-Path $FilePattern) {
        $Files = Get-Item $FilePattern -ErrorAction SilentlyContinue
        foreach ($File in $Files) {
            try {
                $Size = $File.Length
                Remove-Item $File.FullName -Force -ErrorAction SilentlyContinue
                Write-Host "   [x] $($File.FullName.Replace($ROOT_DIR, '.'))" -ForegroundColor Green
                $TotalSize += $Size
            }
            catch {
                Write-ErrorMsg "Failed to delete $($File.FullName) : $_"
            }
        }
    }
}

$TotalMB = [math]::Round($TotalSize / 1MB, 2)
Write-Host "`n[OK] Cleaned $TotalMB MB" -ForegroundColor Cyan
if (-not ($args -contains "--deep")) {
    Write-Host "Tip: Use '.\clear.ps1 --deep' to also remove node_modules." -ForegroundColor Gray
}
