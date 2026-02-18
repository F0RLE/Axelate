$ErrorActionPreference = "Stop"
# Enhanced encoding compatibility for CI/CD
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Console]::OutputEncoding

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
# Use .Path to get clean string
$ROOT_DIR = (Resolve-Path "$SCRIPT_DIR/../..").Path 
$SRC_DIR = Join-Path $ROOT_DIR "src"
$TAURI_DIR = Join-Path $ROOT_DIR "src-tauri"
$TARGET_EXE = Join-Path $TAURI_DIR "target\release\Axelate.exe"

# Determine npm executable based on OS
$NPM_EXEC = if ($IsWindows) { "npm.cmd" } else { "npm" }
$CARGO_EXEC = "cargo"

function Write-Header { param($Message) Write-Host "`n=== $Message ===" -ForegroundColor Cyan }
function Write-Step { param($Message) Write-Host "--> $Message" -ForegroundColor Yellow }
function Write-Success { param($Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-ErrorMsg { param($Message) Write-Host "[!!] $Message" -ForegroundColor Red }

function Exit-Error {
    param($Message)
    Write-ErrorMsg $Message
    if (-not $env:CI) {
        Write-Host "`nPress Enter to exit..." -ForegroundColor Gray
        $null = Read-Host
    }
    exit 1
}

function Exec {
    param(
        [string]$Command,
        [string[]]$CmdArgs,
        [string]$WorkDir
    )

    if (-not (Test-Path $WorkDir)) {
        Exit-Error "Directory not found: $WorkDir"
    }

    Write-Host "> Exec: $Command $CmdArgs" -ForegroundColor DarkGray
    Write-Host "  Dir:  $WorkDir" -ForegroundColor DarkGray
    
    Push-Location $WorkDir
    try {
        & $Command $CmdArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Exit code: $LASTEXITCODE"
        }
    }
    catch {
        Pop-Location 
        Exit-Error "Command '$Command' failed. $_"
    }
    Pop-Location
}

function Initialize-Environment {
    Write-Step "Checking environment..."

    # 1. Check Rust/Cargo
    if (-not (Get-Command $CARGO_EXEC -ErrorAction SilentlyContinue)) {
        Exit-Error "Rust (cargo) is not installed or not in PATH."
    }

    # 2. Check Node.js/NPM
    if (-not (Get-Command $NPM_EXEC -ErrorAction SilentlyContinue)) {
        Exit-Error "Node.js (npm) is not installed or not in PATH."
    }
}

# --- Main Execution ---

Initialize-Environment

Write-Header "Axelate Release Build"

# 1. Run Verification Protocol
Write-Step "Running Verification Protocol..."
$VerifyScript = Join-Path $SCRIPT_DIR "verify-all.ps1"
if (-not (Test-Path $VerifyScript)) {
    Exit-Error "Verify script not found at $VerifyScript"
}

& powershell -ExecutionPolicy Bypass -File $VerifyScript
if ($LASTEXITCODE -ne 0) {
    Exit-Error "Verification failed. Release aborted."
}

# 2. Build Release
Write-Step "Building release executable..."
Get-Process "Axelate" -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "> Exec: npm run tauri:build" -ForegroundColor DarkGray
Exec $NPM_EXEC @("run", "tauri:build") $SRC_DIR

if (Test-Path $TARGET_EXE) {
    $TargetDir = Split-Path $TARGET_EXE
    Write-Host "`n[OK] Build Success!" -ForegroundColor Green
    Write-Host "     Location: $TargetDir" -ForegroundColor White
    Invoke-Item $TargetDir
}
else {
    Exit-Error "Executable not found at $TARGET_EXE"
}
