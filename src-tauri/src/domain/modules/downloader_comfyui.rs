use crate::errors::AppError;
use crate::utils::paths::TEMP_DIR;
use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn prepare_comfyui_module_files(
    extraction_path: &Path,
    release_tag: Option<&str>,
) -> Result<(), AppError> {
    let scripts_dir = extraction_path.join("scripts");
    fs::create_dir_all(&scripts_dir)
        .map_err(|e| AppError::Io(format!("Failed to create ComfyUI scripts directory: {e}")))?;

    let manifest = comfyui_manifest(release_tag);
    let manifest_path = extraction_path.join("axelate-module.toml");
    fs::write(&manifest_path, manifest).map_err(|e| {
        AppError::Io(format!(
            "Failed to write ComfyUI module manifest at {}: {e}",
            manifest_path.display()
        ))
    })?;

    let start_script_path = scripts_dir.join("start.ps1");
    fs::write(&start_script_path, comfyui_start_script()).map_err(|e| {
        AppError::Io(format!(
            "Failed to write ComfyUI start script at {}: {e}",
            start_script_path.display()
        ))
    })?;

    let stop_script_path = scripts_dir.join("stop.ps1");
    fs::write(&stop_script_path, comfyui_stop_script()).map_err(|e| {
        AppError::Io(format!(
            "Failed to write ComfyUI stop script at {}: {e}",
            stop_script_path.display()
        ))
    })?;

    Ok(())
}

fn comfyui_manifest(release_tag: Option<&str>) -> String {
    format!(
        r#"api_version = "1"
id = "comfyui"
name = "ComfyUI"
version = "{version}"
description = "Node-based image workflow engine for maximum quality and control."

[runtime]
kind = "binary"
entry = "scripts/start.ps1"

[lifecycle.start]
program = "powershell"
args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/start.ps1"]

[lifecycle.stop]
program = "powershell"
args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/stop.ps1"]
"#,
        version = release_tag.unwrap_or("unknown")
    )
}

fn comfyui_start_script() -> String {
    r"$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$moduleRoot = Split-Path -Parent $scriptRoot
$childPidPath = Join-Path $moduleRoot 'comfyui.pid'
$stdoutLog = Join-Path $moduleRoot 'comfyui.stdout.log'
$stderrLog = Join-Path $moduleRoot 'comfyui.stderr.log'

function Resolve-ComfyPortable {
    param([string]$rootPath)

    $pythonExe = Get-ChildItem -Path $rootPath -Recurse -File -Filter 'python.exe' |
        Where-Object { $_.FullName -match '[\\/]python_embeded[\\/]python\.exe$' } |
        Select-Object -First 1
    if ($null -eq $pythonExe) {
        throw 'ComfyUI portable python runtime not found.'
    }

    $portableRoot = Split-Path (Split-Path $pythonExe.FullName -Parent) -Parent
    $mainPy = Get-ChildItem -Path $portableRoot -Recurse -File -Filter 'main.py' |
        Where-Object { $_.FullName -match '[\\/]ComfyUI[\\/]main\.py$' } |
        Select-Object -First 1
    if ($null -eq $mainPy) {
        throw 'ComfyUI main.py not found.'
    }

    return [PSCustomObject]@{
        PortableRoot = $portableRoot
        PythonExe = $pythonExe.FullName
        MainPy = $mainPy.FullName
    }
}

if (Test-Path -LiteralPath $childPidPath) {
    $existingPidText = Get-Content -LiteralPath $childPidPath -Raw -ErrorAction SilentlyContinue
    if ($null -ne $existingPidText -and $existingPidText.Trim() -ne '') {
        try {
            $existingPid = [int]$existingPidText.Trim()
            $existingProcess = Get-Process -Id $existingPid -ErrorAction Stop
            Write-Host ('ComfyUI already running on http://127.0.0.1:8188 (PID {0})' -f $existingProcess.Id)
            Wait-Process -Id $existingPid
            exit 0
        } catch {
            Remove-Item -LiteralPath $childPidPath -Force -ErrorAction SilentlyContinue
        }
    }
}

$portable = Resolve-ComfyPortable -rootPath $moduleRoot
$arguments = @(
    '-s',
    $portable.MainPy,
    '--listen',
    '127.0.0.1',
    '--port',
    '8188',
    '--disable-auto-launch'
)

Write-Host 'Starting ComfyUI on http://127.0.0.1:8188'
$process = Start-Process `
    -FilePath $portable.PythonExe `
    -ArgumentList $arguments `
    -WorkingDirectory $portable.PortableRoot `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru `
    -WindowStyle Hidden

Set-Content -LiteralPath $childPidPath -Value $process.Id -Encoding ascii -NoNewline

try {
    $process.WaitForExit()
    exit $process.ExitCode
} finally {
    Remove-Item -LiteralPath $childPidPath -Force -ErrorAction SilentlyContinue
}
"
    .to_string()
}

fn comfyui_stop_script() -> String {
    r"$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$moduleRoot = Split-Path -Parent $scriptRoot
$childPidPath = Join-Path $moduleRoot 'comfyui.pid'

if (!(Test-Path -LiteralPath $childPidPath)) {
    exit 0
}

$pidText = Get-Content -LiteralPath $childPidPath -Raw -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $childPidPath -Force -ErrorAction SilentlyContinue

if ($null -eq $pidText -or $pidText.Trim() -eq '') {
    exit 0
}

$childPid = [int]$pidText.Trim()

try {
    $process = Get-Process -Id $childPid -ErrorAction Stop
    Stop-Process -Id $childPid -Force -ErrorAction Stop
    $process.WaitForExit(5000) | Out-Null
} catch [System.ArgumentException] {
    exit 0
}
"
    .to_string()
}

pub(super) fn build_temp_archive_path(
    module_id: &str,
    asset_index: usize,
    asset_name: &str,
) -> PathBuf {
    let safe_name: String = asset_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    TEMP_DIR.join(format!("{module_id}_{asset_index}_{safe_name}"))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::prepare_comfyui_module_files;

    #[test]
    fn writes_toml_manifest_for_comfyui_module() {
        let temp_dir = tempfile::tempdir().expect("temp dir");

        prepare_comfyui_module_files(temp_dir.path(), Some("1.2.3")).expect("prepare files");

        let manifest_path = temp_dir.path().join("axelate-module.toml");
        let manifest = std::fs::read_to_string(manifest_path).expect("read manifest");

        assert!(manifest.contains("id = \"comfyui\""));
        assert!(manifest.contains("version = \"1.2.3\""));
        assert!(manifest.contains("[lifecycle.start]"));
    }
}
