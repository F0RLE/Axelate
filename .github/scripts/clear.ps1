<#
.SYNOPSIS
    Cleans build artifacts, caches, and target folder.
#>

$ErrorActionPreference = "Continue"
$OutputEncoding = [System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Header {
    param([string]$Message)
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Write-Step {
    param([string]$Message)
    Write-Host "--> $Message" -ForegroundColor Yellow
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-ErrorMsg {
    param($Message)
    Write-Host "[!!] $Message" -ForegroundColor Red
}

# Axelate Cleanup Script (Enhanced)
Write-Header "Axelate - Comprehensive Clean"

$ProjectRoot = Resolve-Path "$PSScriptRoot\..\.."

# Basic Build Artifacts
$DirsToClean = @(
    "$ProjectRoot\src\dist",
    "$ProjectRoot\src\node_modules\.cache",
    "$ProjectRoot\src\node_modules\.vite",
    "$ProjectRoot\src\.vite",
    "$ProjectRoot\src-tauri\target",
    "$ProjectRoot\src-tauri\gen",
    "$ProjectRoot\build"
)

# Logs and Temp Files
$FilesToClean = @(
    "$ProjectRoot\src\npm-debug.log*",
    "$ProjectRoot\src\yarn-debug.log*",
    "$ProjectRoot\src\yarn-error.log*",
    "$ProjectRoot\src\*.log",
    "$ProjectRoot\src-tauri\check_output.txt"
)

# Optional: Deep Clean (Node Modules)
if ($args -contains "--deep") {
    Write-Step "DEEP CLEAN ENABLED: Including node_modules..."
    $DirsToClean += "$ProjectRoot\src\node_modules"
}

$TotalSize = 0

Write-Step "Cleaning directories..."
foreach ($Dir in $DirsToClean) {
    if (Test-Path $Dir) {
        $Size = (Get-ChildItem $Dir -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $SizeMB = [math]::Round($Size / 1MB, 2)
        Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "   [x] $($Dir.Replace($ProjectRoot, '.')) ($SizeMB MB)" -ForegroundColor Green
        $TotalSize += $Size
    }
}

Write-Step "Cleaning trace files..."
foreach ($FilePattern in $FilesToClean) {
    $Files = Get-Item $FilePattern -ErrorAction SilentlyContinue
    foreach ($File in $Files) {
        $Size = $File.Length
        Remove-Item $File.FullName -Force -ErrorAction SilentlyContinue
        Write-Host "   [x] $($File.FullName.Replace($ProjectRoot, '.'))" -ForegroundColor Green
        $TotalSize += $Size
    }
}

$TotalMB = [math]::Round($TotalSize / 1MB, 2)
Write-Host "`n[OK] Cleaned $TotalMB MB" -ForegroundColor Cyan
if (-not ($args -contains "--deep")) {
    Write-Host "Tip: Use '.\clear.ps1 --deep' to also remove node_modules." -ForegroundColor Gray
}
