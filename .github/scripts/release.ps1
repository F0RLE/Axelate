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

. "$SCRIPT_DIR/common.ps1"

# Determine npm executable based on OS
$NPM_EXEC = if ($IsWindows) { "npm.cmd" } else { "npm" }
$CARGO_EXEC = "cargo"

# --- Main Execution ---

Initialize-Environment -CargoExec $CARGO_EXEC -NpmExec $NPM_EXEC

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
Write-Step "Building release executable (Tauri)..."
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
