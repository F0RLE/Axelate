$ErrorActionPreference = "Stop"
# Enhanced encoding compatibility for CI/CD
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Console]::OutputEncoding

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
# Use .Path to get clean string
$ROOT_DIR = (Resolve-Path "$SCRIPT_DIR/../..").Path 

. "$SCRIPT_DIR/common.ps1"

# Determine npm executable based on OS
$NPM_EXEC = if ($IsWindows) { "npm.cmd" } else { "npm" }
$CARGO_EXEC = "cargo"

# --- Main Execution ---

Initialize-Environment -CargoExec $CARGO_EXEC -NpmExec $NPM_EXEC

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
