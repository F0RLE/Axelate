. "$PSScriptRoot\common.ps1"

Assert-Command $CARGO "Rust"
Assert-Command $NPM "Node.js"
Find-WindowsSDK

Write-Header "Axelate: Full Verification"

# Backend
Write-Step "Backend: Rustfmt Check"
Exec $CARGO @("fmt", "--check") $TAURI_DIR

Write-Step "Backend: Clippy (Strict Linting)"
Exec $CARGO @("clippy", "--", "-D", "warnings") $TAURI_DIR

Write-Step "Backend: App Compile Check"
Exec $CARGO @("check", "--bins", "--verbose") $TAURI_DIR

Write-Step "Backend: Library Tests"
Exec $CARGO @("test", "--lib", "--verbose") $TAURI_DIR

Write-Success "Backend Verified"

# Frontend
Write-Step "Frontend: Clean Install (CI simulation)"
Exec $NPM @("ci") $SRC_DIR

Write-Step "Frontend: Checks"
Sync-FrontendBindings
Exec $NPM @("run", "typecheck") $SRC_DIR
Exec $NPM @("run", "lint") $SRC_DIR
Exec $NPM @("run", "format:check") $SRC_DIR
Exec $NPM @("run", "test") $SRC_DIR

Write-Step "Frontend: Build & Size"
Exec $NPM @("run", "build") $SRC_DIR
Exec $NPM @("run", "check-size") $SRC_DIR

Write-Header "SUCCESS: Ready for release"
exit 0
