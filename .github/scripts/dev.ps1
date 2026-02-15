$ErrorActionPreference = "Stop"
# Enhanced encoding compatibility for CI/CD
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Console]::OutputEncoding

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
# Use .Path to get clean string
$ROOT_DIR = (Resolve-Path "$SCRIPT_DIR/../..").Path 
$SRC_DIR = Join-Path $ROOT_DIR "src"

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
    
    # 3. Add Cargo bin to PATH if needed (Windows/Linux)
    $CargoBin = Join-Path $env:USERPROFILE ".cargo/bin"
    if (Test-Path $CargoBin) {
        if ($IsWindows) {
            $env:PATH = "$CargoBin;$env:PATH"
        }
        else {
            $env:PATH = "${CargoBin}:$env:PATH"
        }
    }
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

# --- Main Execution ---

Initialize-Environment

Write-Header "Starting Axelate (Dev Mode)"

# 1. Check Dependencies
if (-not (Test-Path "$SRC_DIR/node_modules")) {
    Write-Step "Installing frontend dependencies..."
    Exec $NPM_EXEC @("install") $SRC_DIR
}

# 2. Auto-Format (Requested Feature)
Write-Step "Auto-formatting code..."
try {
    # We use 'npm run format' which runs prettier --write
    Exec $NPM_EXEC @("run", "format") $SRC_DIR
    Write-Success "Formatting complete"
}
catch {
    Write-ErrorMsg "Formatting failed (non-fatal), expecting dev server to start anyway..."
}

# 3. Start Tauri
Write-Step "Launching Tauri and Vite..."
$AppProcess = Get-Process "Axelate" -ErrorAction SilentlyContinue
if ($AppProcess) {
    Write-Step "Closing existing Axelate instance..."
    $AppProcess | Stop-Process -Force
}

# Run from src directory where package.json scripts are defined
Push-Location $SRC_DIR
Write-Host "> Exec: npm run tauri:dev" -ForegroundColor DarkGray
& $NPM_EXEC run tauri:dev
if ($LASTEXITCODE -ne 0) {
    Write-ErrorMsg "Tauri exited with code $LASTEXITCODE"
    # Don't pause on exit here usually as users might Ctrl+C
}
Pop-Location
