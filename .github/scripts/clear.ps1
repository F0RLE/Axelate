<#
.SYNOPSIS
    Cleans build artifacts, caches, and target folder.
#>

. "$PSScriptRoot\common.ps1"
$ErrorActionPreference = "Continue" # Override: don't stop on clean errors

$DirsToClean = @(
    "$ROOT_DIR/src/dist",
    "$ROOT_DIR/src/node_modules/.cache",
    "$ROOT_DIR/src/node_modules/.vite",
    "$ROOT_DIR/src/.vite",
    "$ROOT_DIR/src-tauri/target",
    "$ROOT_DIR/src-tauri/gen",
    "$ROOT_DIR/build"
)

$FilesToClean = @(
    "$ROOT_DIR/src/npm-debug.log*",
    "$ROOT_DIR/src/yarn-debug.log*",
    "$ROOT_DIR/src/yarn-error.log*",
    "$ROOT_DIR/src/*.log",
    "$ROOT_DIR/src-tauri/check_output.txt"
)

if ($args -contains "--deep") {
    Write-Step "DEEP CLEAN: Including node_modules..."
    $DirsToClean += "$ROOT_DIR/src/node_modules"
}

Write-Header "Axelate - Clean"

$TotalSize = 0

Write-Step "Cleaning directories..."
foreach ($Dir in $DirsToClean) {
    if (Test-Path $Dir) {
        try {
            $Size = (Get-ChildItem $Dir -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
            Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "   [x] $($Dir.Replace($ROOT_DIR, '.')) ($([math]::Round($Size / 1MB, 2)) MB)" -ForegroundColor Green
            $TotalSize += $Size
        }
        catch { Write-ErrorMsg "Failed: $Dir — $_" }
    }
}

Write-Step "Cleaning trace files..."
foreach ($Pattern in $FilesToClean) {
    if (Test-Path $Pattern) {
        foreach ($File in (Get-Item $Pattern -ErrorAction SilentlyContinue)) {
            try {
                $TotalSize += $File.Length
                Remove-Item $File.FullName -Force -ErrorAction SilentlyContinue
                Write-Host "   [x] $($File.FullName.Replace($ROOT_DIR, '.'))" -ForegroundColor Green
            }
            catch { Write-ErrorMsg "Failed: $($File.FullName) — $_" }
        }
    }
}

Write-Host "`n[OK] Cleaned $([math]::Round($TotalSize / 1MB, 2)) MB" -ForegroundColor Cyan
if (-not ($args -contains "--deep")) {
    Write-Host "Tip: Use '--deep' to also remove node_modules." -ForegroundColor Gray
}
