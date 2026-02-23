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

Write-Header "Starting Axelate (Dev Mode)"

# 1. Check Dependencies
if (-not (Test-Path "$SRC_DIR/node_modules")) {
    Write-Step "Installing frontend dependencies..."
    Exec $NPM_EXEC @("install") $SRC_DIR
}

# 2. Export TS Bindings
Write-Step "Exporting TypeScript bindings..."
Exec $CARGO_EXEC @("run", "--bin", "export-bindings") $TAURI_DIR

# 3. Auto-Format (Requested Feature)
Write-Step "Auto-formatting code..."
try {
    # We use 'npm run format' which runs prettier --write
    Exec $NPM_EXEC @("run", "format") $SRC_DIR
    Write-Success "Formatting complete"
}
catch {
    Write-ErrorMsg "Formatting failed (non-fatal), expecting dev server to start anyway..."
}

# 4. Start Tauri
Write-Step "Launching Tauri and Vite..."
$AppProcess = Get-Process "Axelate" -ErrorAction SilentlyContinue
if ($AppProcess) {
    Write-Step "Closing existing Axelate instance..."
    $AppProcess | Stop-Process -Force
}

# Run from src directory where package.json scripts are defined
Push-Location $SRC_DIR
Write-Host "> Exec: npm run tauri:dev" -ForegroundColor DarkGray
& $NPM_EXEC run tauri:dev
if ($LASTEXITCODE -ne 0) {
    Write-ErrorMsg "Tauri exited with code $LASTEXITCODE"
    # Don't pause on exit here usually as users might Ctrl+C
}
Pop-Location
