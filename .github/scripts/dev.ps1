<#
.SYNOPSIS
    Launches Axelate in development mode.

.DESCRIPTION
    Standard development launch script.
    Running this script starts both the Vite frontend server and the Tauri backend.
#>

$ErrorActionPreference = "Stop"
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

# Trap unexpected errors since preference is Stop
trap {
    Exit-Error "Unexpected error: $_"
}

Write-Header "Starting Axelate (Dev Mode)"

# 1. Setup Environment
$ScriptDir = $PSScriptRoot
$SrcDir = "$ScriptDir\..\..\src"
$TauriDir = "$ScriptDir\..\..\src-tauri"

# Ensure Cargo is found
$env:PATH = "$env:USERPROFILE\.cargo\bin;" + $env:PATH

# 2. Check Dependencies
if (-not (Test-Path "$SrcDir\node_modules")) {
    Write-Step "Installing frontend dependencies..."
    Set-Location $SrcDir
    npm install
}

# 3. Start Tauri (Vite is started automatically by beforeDevCommand)
Write-Step "Launching Tauri (Vite will start automatically)..."
Set-Location $TauriDir
# Specify stable-msvc explicitly to avoid ambiguity
rustup run stable-msvc cargo tauri dev
