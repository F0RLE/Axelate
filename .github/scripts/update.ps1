$ErrorActionPreference = "Stop"
# Enhanced encoding compatibility for CI/CD
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Console]::OutputEncoding

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
# Use .Path to get clean string
$ROOT_DIR = (Resolve-Path "$SCRIPT_DIR/../..").Path 

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

Write-Header "Project Root: $ROOT_DIR"

Write-Step "Updating Frontend dependencies (npm)..."
Exec $NPM_EXEC @("update") "$ROOT_DIR/src"
Write-Success "Frontend updated."

Write-Step "Updating Backend dependencies (cargo)..."
Exec $CARGO_EXEC @("update") "$ROOT_DIR/src-tauri"
Write-Success "Backend updated."

Write-Header "Verifying stability..."

# Delegate to standardized verification script
$VerifyScript = Join-Path $SCRIPT_DIR "verify-all.ps1"
if (-not (Test-Path $VerifyScript)) {
    Exit-Error "Verify script not found at $VerifyScript"
}

Write-Host "> Executing verification script..." -ForegroundColor DarkGray
& powershell -ExecutionPolicy Bypass -File $VerifyScript

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[OK] All dependencies updated and verified successfully!" -ForegroundColor Green
}
else {
    Exit-Error "Verification failed after update!"
}
