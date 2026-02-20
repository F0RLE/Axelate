$ErrorActionPreference = "Stop"
# Enhanced encoding compatibility for CI/CD
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Console]::OutputEncoding

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
# Use .Path to get clean string
$ROOT_DIR = (Resolve-Path "$SCRIPT_DIR/../..").Path 
$SRC_DIR = Join-Path $ROOT_DIR "src"
$TAURI_DIR = Join-Path $ROOT_DIR "src-tauri"

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
        # Don't wait for input if running in CI
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
        Pop-Location # Return even on error
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
    
    # 3. Windows-specific: RC.EXE check
    if ($IsWindows) {
        if (-not (Get-Command rc.exe -ErrorAction SilentlyContinue)) {
            Write-Host "RC.EXE not found in current PATH. Searching Windows Kits..." -ForegroundColor Yellow
            
            $kitsRoots = @(
                "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
                "${env:ProgramFiles}\Windows Kits\10\bin"
            )

            foreach ($kitsRoot in $kitsRoots) {
                if (Test-Path $kitsRoot) {
                    $versions = Get-ChildItem $kitsRoot | 
                        Where-Object { $_.PSIsContainer -and $_.Name -match '^\d+\.' } | 
                        Sort-Object Name -Descending
                    
                    foreach ($ver in $versions) {
                        # Try x64 then x86
                        foreach ($arch in @("x64", "x86")) {
                            $rcPath = Join-Path $ver.FullName $arch
                            if (Test-Path (Join-Path $rcPath "rc.exe")) {
                                Write-Host "Found RC.EXE at: $rcPath" -ForegroundColor DarkGray
                                # Add to PATH and also set it for the process
                                $env:PATH = "$rcPath;$env:PATH"
                                return # Found it!
                            }
                        }
                    }
                }
            }
            Write-ErrorMsg "RC.EXE could not be located. High-level build might fail."
            Write-Host "Please ensure 'Windows 10/11 SDK' and 'C++ Build Tools' are installed via VS Installer." -ForegroundColor Gray
        }
    }
}

# --- Main Execution ---

Initialize-Environment

Write-Header "Axelate: Full Verification"

# 1. Backend
Write-Step "Backend (Rust)"
Exec $CARGO_EXEC @("check", "--all-targets") $TAURI_DIR

Write-Success "Backend Verified"

# 2. Frontend
Write-Step "Frontend (TypeScript)"

Exec $NPM_EXEC @("run", "typecheck") $SRC_DIR
Exec $NPM_EXEC @("run", "lint") $SRC_DIR
Exec $NPM_EXEC @("run", "format:check") $SRC_DIR
Exec $NPM_EXEC @("run", "test") $SRC_DIR

Write-Step "Frontend Build & Size"
Exec $NPM_EXEC @("run", "build") $SRC_DIR
Exec $NPM_EXEC @("run", "check-size") $SRC_DIR

Write-Header "SUCCESS: Ready for release"
exit 0
