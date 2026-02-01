$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROOT_DIR = Resolve-Path "$SCRIPT_DIR/../.."
$SRC_DIR = Join-Path $ROOT_DIR "src"
$TAURI_DIR = Join-Path $ROOT_DIR "src-tauri"

function Write-Header {
    param($Message)
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Write-Step {
    param($Message)
    Write-Host "--> $Message" -ForegroundColor Yellow
}

function Write-Success {
    param($Message)
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

function Exec {
    param($Command, $CmdArgs, $WorkDir)
    Write-Host "> Executing: $Command $CmdArgs (in $WorkDir)" -ForegroundColor DarkGray
    
    Push-Location $WorkDir
    try {
        & $Command $CmdArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code $LASTEXITCODE"
        }
    }
    catch {
        Exit-Error "Command failed: $_"
    }
    Pop-Location
}

Write-Header "Starting Full Project Verification (Axelate)"

# 1. Backend Verification
Write-Step "Backend (Rust) Verification"
Exec "cargo" @("fmt", "--", "--check") $TAURI_DIR
Exec "cargo" @("clippy", "--", "-D", "warnings") $TAURI_DIR
Exec "cargo" @("test") $TAURI_DIR
Write-Success "Backend checks passed"

# 2. Frontend Verification
Write-Step "Frontend (TypeScript) Verification"

# Typecheck (from root, calling tsc on src)
Exec "npm.cmd" @("run", "typecheck") $ROOT_DIR

# Lint
Exec "npm.cmd" @("run", "lint") $SRC_DIR

# Format Check
Exec "npm.cmd" @("run", "format:check") $SRC_DIR

# Tests
Exec "npm.cmd" @("run", "test") $SRC_DIR

# Build & Size Check
Write-Step "Frontend Build & Size Check"
Exec "npm.cmd" @("run", "build") $SRC_DIR
Exec "npm.cmd" @("run", "check-size") $SRC_DIR

Write-Success "Frontend checks passed"

Write-Header "All checks passed successfully! Ready for release."
exit 0
