<#
.SYNOPSIS
    Cleans build artifacts, caches, and target folder.
#>

$ErrorActionPreference = "Continue"

Write-Host "`n🧹 Flux Platform - Clean" -ForegroundColor Cyan

$ProjectRoot = Resolve-Path "$PSScriptRoot\..\.."

$DirsToClean = @(
    "$ProjectRoot\src\dist",
    "$ProjectRoot\src\node_modules\.cache",
    "$ProjectRoot\src\node_modules\.vite",
    "$ProjectRoot\src\.vite",
    "$ProjectRoot\src-tauri\target",
    "$ProjectRoot\build"
)

$TotalSize = 0

foreach ($Dir in $DirsToClean) {
    if (Test-Path $Dir) {
        $Size = (Get-ChildItem $Dir -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $SizeMB = [math]::Round($Size / 1MB, 2)
        Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "   ✓ $($Dir.Replace($ProjectRoot, '.')) ($SizeMB MB)" -ForegroundColor Green
        $TotalSize += $Size
    }
}

$TotalMB = [math]::Round($TotalSize / 1MB, 2)
Write-Host "`n✅ Cleaned $TotalMB MB" -ForegroundColor Cyan
