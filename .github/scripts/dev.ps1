. "$PSScriptRoot\common.ps1"

Assert-Command $CARGO "Rust"
Assert-Command $NPM "Node.js"
Find-WindowsSDK

# Add cargo bin to PATH
$CargoBin = Join-Path $env:USERPROFILE ".cargo/bin"
if (Test-Path $CargoBin) {
    $sep = if ($IsWindows) { ";" } else { ":" }
    $env:PATH = "$CargoBin$sep$env:PATH"
}

Write-Header "Starting Axelate (Dev Mode)"

# Install if needed
if (-not (Test-Path "$SRC_DIR/node_modules")) {
    Write-Step "Installing frontend dependencies..."
    Exec $NPM @("install") $SRC_DIR
}

# Auto-format
Write-Step "Auto-formatting code..."
try {
    Exec $NPM @("run", "format") $SRC_DIR
    Write-Success "Formatting complete"
}
catch {
    Write-ErrorMsg "Formatting failed (non-fatal)..."
}

# Launch Tauri
Write-Step "Launching Tauri and Vite..."
Get-Process "Axelate" -ErrorAction SilentlyContinue | Stop-Process -Force

Push-Location $SRC_DIR
& $NPM run tauri:dev
if ($LASTEXITCODE -ne 0) {
    Write-ErrorMsg "Tauri exited with code $LASTEXITCODE"
}
Pop-Location
