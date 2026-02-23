$ErrorActionPreference = "Stop"
# Enhanced encoding compatibility for CI/CD
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Console]::OutputEncoding

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
# Use .Path to get clean string
$ROOT_DIR = (Resolve-Path "$SCRIPT_DIR/../..").Path 
$SRC_DIR = Join-Path $ROOT_DIR "src"
$TAURI_DIR = Join-Path $ROOT_DIR "src-tauri"

. "$SCRIPT_DIR/common.ps1"

# Determine npm executable based on OS
$NPM_EXEC = if ($IsWindows) { "npm.cmd" } else { "npm" }
$CARGO_EXEC = "cargo"

# --- Main Execution ---

Initialize-Environment -CargoExec $CARGO_EXEC -NpmExec $NPM_EXEC

Write-Header "Axelate: Full Verification"

# 1. Backend
Write-Step "Backend (Rust)"
Exec $CARGO_EXEC @("check", "--all-targets") $TAURI_DIR

# 2. Type Bindings
Write-Step "Exporting TypeScript bindings..."
Exec $CARGO_EXEC @("run", "--bin", "export-bindings") $TAURI_DIR

Write-Success "Backend & Bindings Verified"

# 3. Frontend
Write-Step "Frontend (TypeScript)"

Exec $NPM_EXEC @("run", "typecheck") $SRC_DIR
Exec $NPM_EXEC @("run", "lint") $SRC_DIR
Exec $NPM_EXEC @("run", "format:check") $SRC_DIR
Exec $NPM_EXEC @("run", "test") $SRC_DIR

Write-Step "Frontend Build & Size Check"
Exec $NPM_EXEC @("run", "build") $SRC_DIR
Exec $NPM_EXEC @("run", "check-size") $SRC_DIR

Write-Header "SUCCESS: Ready for release"
exit 0
