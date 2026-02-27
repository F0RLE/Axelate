$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Console]::OutputEncoding

# --- Paths ---
$script:SCRIPT_DIR = Split-Path -Parent $MyInvocation.ScriptName
$script:ROOT_DIR   = (Resolve-Path "$script:SCRIPT_DIR/../..").Path
$script:SRC_DIR    = Join-Path $script:ROOT_DIR "src"
$script:TAURI_DIR  = Join-Path $script:ROOT_DIR "src-tauri"

# --- Executables ---
$script:NPM   = if ($IsWindows) { "npm.cmd" } else { "npm" }
$script:CARGO = "cargo"

# --- Output Helpers ---
function Write-Header  { param($Message) Write-Host "`n=== $Message ===" -ForegroundColor Cyan }
function Write-Step    { param($Message) Write-Host "--> $Message" -ForegroundColor Yellow }
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

# --- Core Functions ---

function Exec {
    param(
        [string]$Command,
        [string[]]$CmdArgs,
        [string]$WorkDir
    )
    if (-not (Test-Path $WorkDir)) { Exit-Error "Directory not found: $WorkDir" }

    Write-Host "> $Command $CmdArgs" -ForegroundColor DarkGray
    Push-Location $WorkDir
    try {
        & $Command $CmdArgs
        if ($LASTEXITCODE -ne 0) { throw "Exit code: $LASTEXITCODE" }
    }
    catch {
        Pop-Location
        Exit-Error "Command '$Command' failed. $_"
    }
    Pop-Location
}

function Assert-Command {
    param([string]$Name, [string]$Label)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Exit-Error "$Label ($Name) is not installed or not in PATH."
    }
}

function Find-WindowsSDK {
    if (-not $IsWindows) { return }
    if (Get-Command "rc.exe" -ErrorAction SilentlyContinue) { return }

    $KitsBase = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (-not (Test-Path $KitsBase)) {
        Write-ErrorMsg "Windows SDK not found. Install via VS Installer."
        return
    }

    $RcExe = Get-ChildItem $KitsBase -Recurse -Filter "rc.exe" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "\\x64\\" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1

    if ($RcExe) {
        $env:PATH = "$($RcExe.DirectoryName);$env:PATH"
        Write-Step "Windows SDK: $($RcExe.DirectoryName)"
    } else {
        Write-ErrorMsg "rc.exe not found. Install Windows 10/11 SDK."
    }
}
