$ErrorActionPreference = "Stop"
$Root = (Resolve-Path "$PSScriptRoot/../..").Path

Write-Host "Project Root: $Root" -ForegroundColor Gray

Write-Host "Updating Frontend dependencies (npm)..." -ForegroundColor Cyan
Set-Location "$Root/src"
npm update
if ($?) { Write-Host "Frontend updated." -ForegroundColor Green }

Write-Host "`nUpdating Backend dependencies (cargo)..." -ForegroundColor Cyan
Set-Location "$Root/src-tauri"
cargo update
if ($?) { Write-Host "Backend updated." -ForegroundColor Green }

Write-Host "`nVerifying stability..." -ForegroundColor Cyan
Set-Location $Root

function wait_exit {
    Write-Host "`nPress Enter to close..." -ForegroundColor Gray
    $null = Read-Host
    exit 1
}

# 1. Run Typescript & Lint checks
Write-Host "  - Running Lint & Format checks..."
npm run lint
if (!$?) { Write-Error "Linting failed after update!"; wait_exit }

# 2. Run Tests
Write-Host "  - Running Frontend Tests..."
npm test
if (!$?) { Write-Error "Tests failed after update!"; wait_exit }

# 3. Check Backend Build
Write-Host "  - Checking Backend compilation..."
Set-Location "$Root/src-tauri"
cargo check
if (!$?) { Write-Error "Backend check failed after update!"; wait_exit }

Write-Host "`nAll dependencies updated and verified successfully!" -ForegroundColor Green
