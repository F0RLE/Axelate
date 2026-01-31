<#
.SYNOPSIS
    Builds Axelate release and copies to build folder.
#>

$ErrorActionPreference = 'Stop'
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
    param([string]$Message)
    Write-Host "[!!] $Message" -ForegroundColor Red
}

function Exit-Error {
    param($Message)
    Write-ErrorMsg $Message
    Write-Host "`nPress Enter to exit..." -ForegroundColor Gray
    $null = Read-Host
    exit 1
}

Write-Header "Axelate Release Build"

# Paths
$ProjectRoot = Resolve-Path "$PSScriptRoot\..\.."
$SrcDir = "$ProjectRoot\src"
$TauriDir = "$ProjectRoot\src-tauri"
$BuildDir = "$ProjectRoot\build"
$TargetExe = "$TauriDir\target\x86_64-pc-windows-msvc\release\Axelate.exe"
$OutputExe = "$BuildDir\Axelate.exe"

# 1. Run Verification Protocol
Write-Step "Running Verification Protocol..."
$VerifyScript = "$PSScriptRoot\verify-all.ps1"
powershell -ExecutionPolicy Bypass -File $VerifyScript

if ($LASTEXITCODE -ne 0) {
    Exit-Error "Verification failed. Release aborted."
}

# Environment
$env:PATH = "$env:USERPROFILE\.cargo\bin;" + $env:PATH

# Build using npm script (runs tauri from src/node_modules)
Write-Step "Building release executable..."
Set-Location $SrcDir
npm run tauri:build

if ($LASTEXITCODE -ne 0) {
    Exit-Error "Build failed"
}

# Copy to build folder
if (Test-Path $TargetExe) {
    New-Item -ItemType Directory -Path $BuildDir -Force | Out-Null
    Copy-Item $TargetExe $OutputExe -Force

    $Size = "{0:N2} MB" -f ((Get-Item $OutputExe).Length / 1MB)
    Write-Host "`n[OK] Build Success!" -ForegroundColor Green
    Write-Host "     Output: $OutputExe" -ForegroundColor White
    Write-Host "     Size:   $Size" -ForegroundColor White
}
else {
    Exit-Error "Executable not found at $TargetExe"
}
