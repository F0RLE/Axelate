. "$PSScriptRoot\common.ps1"

Assert-Command $CARGO "Rust"
Assert-Command $NPM "Node.js"

Write-Header "Axelate: Update Dependencies"

Write-Step "Updating Frontend (npm)..."
Exec $NPM @("update") $SRC_DIR
Write-Success "Frontend updated."

Write-Step "Updating Backend (cargo)..."
Exec $CARGO @("update") $TAURI_DIR
Write-Success "Backend updated."

# Verify stability after update
Write-Header "Verifying stability..."
$VerifyScript = Join-Path $SCRIPT_DIR "verify-all.ps1"
if (-not (Test-Path $VerifyScript)) { Exit-Error "Verify script not found at $VerifyScript" }

& powershell -ExecutionPolicy Bypass -File $VerifyScript
if ($LASTEXITCODE -eq 0) {
    Write-Success "All dependencies updated and verified!"
}
else {
    Exit-Error "Verification failed after update!"
}
