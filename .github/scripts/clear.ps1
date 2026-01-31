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

Write-Header "Axelate - Clean"

$ProjectRoot = Resolve-Path "$PSScriptRoot\..\.."

$DirsToClean = @(
    "$ProjectRoot\src\dist",
    "$ProjectRoot\src\node_modules\.cache",
    "$ProjectRoot\src\node_modules\.vite",
    "$ProjectRoot\src\.vite",
    "$ProjectRoot\src-tauri\target",
    "$ProjectRoot\build"
)

$TotalSize = 0

foreach ($Dir in $DirsToClean) {
    if (Test-Path $Dir) {
        $Size = (Get-ChildItem $Dir -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $SizeMB = [math]::Round($Size / 1MB, 2)
        Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "   [x] $($Dir.Replace($ProjectRoot, '.')) ($SizeMB MB)" -ForegroundColor Green
        $TotalSize += $Size
    }
}

$TotalMB = [math]::Round($TotalSize / 1MB, 2)
Write-Host "`n[OK] Cleaned $TotalMB MB" -ForegroundColor Cyan
