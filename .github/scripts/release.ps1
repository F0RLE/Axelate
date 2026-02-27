. "$PSScriptRoot\common.ps1"

Assert-Command $CARGO "Rust"
Assert-Command $NPM "Node.js"

Write-Header "Axelate Release Build"

# 1. Verify
Write-Step "Running Verification Protocol..."
$VerifyScript = Join-Path $SCRIPT_DIR "verify-all.ps1"
if (-not (Test-Path $VerifyScript)) { Exit-Error "Verify script not found at $VerifyScript" }

& powershell -ExecutionPolicy Bypass -File $VerifyScript
if ($LASTEXITCODE -ne 0) { Exit-Error "Verification failed. Release aborted." }

# 2. Build
Write-Step "Building release executable..."
Get-Process "Axelate" -ErrorAction SilentlyContinue | Stop-Process -Force
Exec $NPM @("run", "tauri:build") $SRC_DIR

$TargetExe = Join-Path $TAURI_DIR "target\release\Axelate.exe"
if (Test-Path $TargetExe) {
    $TargetDir = Split-Path $TargetExe
    Write-Success "Build complete! Location: $TargetDir"
    Invoke-Item $TargetDir
}
else {
    Exit-Error "Executable not found at $TargetExe"
}
