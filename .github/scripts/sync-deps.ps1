# sync-deps.ps1
# Helper script to pull latest changes from main and update all dependencies locally.

$currentBranch = git branch --show-current
Write-Host "Pulling latest changes from origin/$currentBranch..." -ForegroundColor Cyan
git pull origin $currentBranch

Write-Host "`nUpdating frontend dependencies (npm)..." -ForegroundColor Cyan
Push-Location src
npm install
Pop-Location

Write-Host "`nUpdating backend dependencies (cargo)..." -ForegroundColor Cyan
Push-Location src-tauri
cargo fetch
Pop-Location

Write-Host "`nAll dependencies synchronized!" -ForegroundColor Green
