# sync-deps.ps1
# Helper script to pull latest changes from main and update all dependencies locally.

Write-Host "Fetching latest changes from remote..." -ForegroundColor Cyan
git pull origin main

Write-Host "`nUpdating frontend dependencies (npm)..." -ForegroundColor Cyan
Push-Location src
npm install
Pop-Location

Write-Host "`nUpdating backend dependencies (cargo)..." -ForegroundColor Cyan
Push-Location src-tauri
cargo fetch
Pop-Location

Write-Host "`nAll dependencies synchronized!" -ForegroundColor Green
