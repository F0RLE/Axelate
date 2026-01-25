<#
.SYNOPSIS
    Builds Flux Platform release and copies to build folder.
#>

$ErrorActionPreference = 'Stop'

Write-Host "🚀 Flux Platform Release Build" -ForegroundColor Cyan

# Paths
$ProjectRoot = Resolve-Path "$PSScriptRoot\..\.."
$SrcDir = "$ProjectRoot\src"
$TauriDir = "$ProjectRoot\src-tauri"
$BuildDir = "$ProjectRoot\build"
$TargetExe = "$TauriDir\target\x86_64-pc-windows-msvc\release\Flux Platform.exe"
$OutputExe = "$BuildDir\Flux Platform.exe"

# Environment
$env:PATH = "$env:USERPROFILE\.cargo\bin;" + $env:PATH

# Validation
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "❌ Cargo not found. Install Rust first."
    exit 1
}

# Install frontend dependencies if needed
if (-not (Test-Path "$SrcDir\node_modules")) {
    Write-Host "📦 Installing npm dependencies..." -ForegroundColor Yellow
    Set-Location $SrcDir
    npm install
}

# Build using npm script (runs tauri from src/node_modules)
Write-Host "🔨 Building release..." -ForegroundColor Yellow
Set-Location $SrcDir
npm run tauri:build

if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Build failed"
    exit 1
}

# Copy to build folder
if (Test-Path $TargetExe) {
    New-Item -ItemType Directory -Path $BuildDir -Force | Out-Null
    Copy-Item $TargetExe $OutputExe -Force

    $Size = "{0:N2} MB" -f ((Get-Item $OutputExe).Length / 1MB)
    Write-Host "`n✅ Build Success!" -ForegroundColor Green
    Write-Host "   Output: $OutputExe" -ForegroundColor White
    Write-Host "   Size:   $Size" -ForegroundColor White
}
else {
    Write-Error "❌ Executable not found"
    exit 1
}
