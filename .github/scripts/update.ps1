$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Root = (Resolve-Path "$PSScriptRoot/../..").Path

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

function Exit-Error {
    param($Message)
    Write-ErrorMsg $Message
    Write-Host "`nPress Enter to exit..." -ForegroundColor Gray
    $null = Read-Host
    exit 1
}

Write-Header "Project Root: $Root"

Write-Step "Updating Frontend dependencies (npm)..."
Set-Location "$Root/src"
npm update
if ($?) { Write-Success "Frontend updated." }

Write-Step "Updating Backend dependencies (cargo)..."
Set-Location "$Root/src-tauri"
cargo update
if ($?) { Write-Success "Backend updated." }

Write-Host "`nVerifying stability..." -ForegroundColor Cyan

# Delegate to standardized verification script
$VerifyScript = "$PSScriptRoot\verify-all.ps1"
powershell -ExecutionPolicy Bypass -File $VerifyScript

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[OK] All dependencies updated and verified successfully!" -ForegroundColor Green
}
else {
    Exit-Error "Verification failed after update!"
}
