# ==============================================================================
# Axelate Pipeline Shared Component
# Common output, execution, and environment initialization for CI/CD scripts
# ==============================================================================

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
        Pop-Location # Return even on error
        Exit-Error "Command '$Command' failed. $_"
    }
    Pop-Location
}

function Initialize-Environment {
    param(
        [string]$CargoExec = "cargo",
        [string]$NpmExec = $(if ($IsWindows) { "npm.cmd" } else { "npm" })
    )

    Write-Step "Checking environment dependencies..."

    # 1. Check Rust/Cargo
    if (-not (Get-Command $CargoExec -ErrorAction SilentlyContinue)) {
        # Check if it's in the default user directory before failing
        $CargoBin = Join-Path $env:USERPROFILE ".cargo/bin"
        if (Test-Path $CargoBin) {
            if ($IsWindows) {
                $env:PATH = "$CargoBin;$env:PATH"
            }
            else {
                $env:PATH = "${CargoBin}:$env:PATH"
            }
        }
        
        if (-not (Get-Command $CargoExec -ErrorAction SilentlyContinue)) {
            Exit-Error "Rust (cargo) is not installed or not in PATH."
        }
    }

    # 2. Check Node.js/NPM
    if (-not (Get-Command $NpmExec -ErrorAction SilentlyContinue)) {
        Exit-Error "Node.js (npm) is not installed or not in PATH."
    }
    
    # 3. Windows-specific: RC.EXE check (required for Tauri app icon compilation)
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
