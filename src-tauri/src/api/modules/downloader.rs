use crate::domain::modules::downloader;
use crate::domain::modules::downloader::DownloadRequest;
use crate::errors::AppError;
use std::path::Path;
use std::process::Command;
use tauri::AppHandle;

fn resume_request_for_module(
    module_id: &str,
    request: Option<DownloadRequest>,
) -> Result<DownloadRequest, AppError> {
    request
        .ok_or_else(|| AppError::NotFound(format!("No paused download metadata for {module_id}")))
}

fn list_regular_file_names(path: &Path) -> Result<Vec<String>, AppError> {
    if !path.exists() {
        return Err(AppError::NotFound(
            "Module directory does not exist".to_string(),
        ));
    }

    let entries = std::fs::read_dir(path)?;
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            files.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    files.sort();

    Ok(files)
}

fn resolve_existing_module_dir(module_id: &str) -> Result<std::path::PathBuf, AppError> {
    downloader::validate_module_id(module_id)?;
    let path = downloader::get_module_path(module_id);
    if !path.is_dir() {
        return Err(AppError::NotFound(format!(
            "Module directory does not exist: {module_id}"
        )));
    }

    Ok(path)
}

fn open_folder(path: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer").arg(path).spawn().map(|_| ())
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(path).spawn().map(|_| ())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(path).spawn().map(|_| ())
    }
}

#[tauri::command]
#[specta::specta]
/// Downloads and verifies a module from a Git repository
pub async fn download_module(
    app: AppHandle,
    downloader: tauri::State<'_, downloader::DownloaderService>,
    module_id: String,
    repo_url: String,
    expected_hash: Option<String>,
    dl_type: Option<String>,
    release_selection: Option<crate::domain::modules::github_releases::ReleaseDownloadSelection>,
) -> Result<String, AppError> {
    downloader::download_module(
        app,
        &downloader,
        module_id,
        repo_url,
        expected_hash,
        dl_type,
        release_selection,
    )
    .await
}

#[tauri::command]
#[specta::specta]
/// Lists compatible release versions and CPU/GPU package choices for a module.
pub async fn get_release_download_options(
    module_id: String,
    repo_url: String,
) -> Result<crate::domain::modules::github_releases::ReleaseDownloadOptions, AppError> {
    downloader::get_release_download_options(&module_id, &repo_url).await
}

#[tauri::command]
#[specta::specta]
/// Imports an integration from a local folder containing `axelate-module.toml`.
pub async fn import_integration_folder(path: String) -> Result<String, AppError> {
    downloader::import_integration_folder(&std::path::PathBuf::from(path)).await
}

#[tauri::command]
#[specta::specta]
/// Imports an integration from a local `.zip`, `.tar.gz`, `.tgz`, or `.7z` archive.
pub async fn import_integration_archive(app: AppHandle, path: String) -> Result<String, AppError> {
    downloader::import_integration_archive(app, std::path::PathBuf::from(path)).await
}

#[tauri::command]
#[specta::specta]
/// Imports an integration from a local folder or archive, auto-detected by path type.
pub async fn import_integration_path(app: AppHandle, path: String) -> Result<String, AppError> {
    downloader::import_integration_path(app, std::path::PathBuf::from(path)).await
}

#[tauri::command]
#[specta::specta]
/// Downloads and imports an integration from a repository or archive URL.
pub async fn import_integration_url(
    app: AppHandle,
    downloader: tauri::State<'_, downloader::DownloaderService>,
    source_url: String,
) -> Result<String, AppError> {
    downloader::import_integration_url(app, &downloader, source_url).await
}

#[tauri::command]
#[specta::specta]
/// Resumes a paused module download using backend-owned request metadata.
pub async fn resume_download(
    app: AppHandle,
    downloader: tauri::State<'_, downloader::DownloaderService>,
    module_id: String,
) -> Result<String, AppError> {
    let request = resume_request_for_module(&module_id, downloader.get_request(&module_id))?;

    downloader::download_module(
        app,
        &downloader,
        module_id,
        request.repo_url,
        request.expected_hash,
        request.dl_type,
        request.release_selection,
    )
    .await
}

#[tauri::command]
#[specta::specta]
/// Checks if a module is already installed locally
pub fn check_module_installed(module_id: &str) -> Result<bool, AppError> {
    Ok(downloader::is_module_installed(module_id))
}

#[tauri::command]
#[specta::specta]
/// Retrieves the filesystem path to a module's directory
pub fn get_module_path(module_id: &str) -> Result<String, AppError> {
    downloader::validate_module_id(module_id)?;

    Ok(downloader::get_module_path(module_id)
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
#[specta::specta]
/// Opens an installed module directory in the system file manager.
pub fn open_module_folder(module_id: &str) -> Result<(), AppError> {
    let path = resolve_existing_module_dir(module_id)?;
    open_folder(&path).map_err(|error| AppError::Io(error.to_string()))
}

#[tauri::command]
#[specta::specta]
/// Deletes a module from local storage
pub async fn delete_module(module_id: &str) -> Result<(), AppError> {
    downloader::delete_module(module_id).await
}

#[tauri::command]
#[specta::specta]
/// Lists all files in a module's directory
pub async fn list_module_files(module_id: &str) -> Result<Vec<String>, AppError> {
    downloader::validate_module_id(module_id)?;

    let path = downloader::get_module_path(module_id);
    list_regular_file_names(&path)
}

#[tauri::command]
#[specta::specta]
/// Configures download bandwidth limits
#[allow(clippy::needless_pass_by_value)]
pub fn set_download_settings(
    downloader: tauri::State<'_, downloader::DownloaderService>,
    enabled: bool,
    max_speed: u32,
) {
    downloader.set_limit(enabled, max_speed);
}

#[tauri::command]
#[specta::specta]
/// Cancels an in-progress module download
#[allow(clippy::needless_pass_by_value)]
pub fn cancel_download(
    downloader: tauri::State<'_, downloader::DownloaderService>,
    module_id: String,
) -> bool {
    downloader.cancel(&module_id)
}

#[tauri::command]
#[specta::specta]
/// Pauses an in-progress module download while preserving partial files for resume
#[allow(clippy::needless_pass_by_value)]
pub fn pause_download(
    downloader: tauri::State<'_, downloader::DownloaderService>,
    module_id: String,
) -> bool {
    downloader.pause(&module_id)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use crate::domain::modules::github_releases::{ReleaseComputeTarget, ReleaseDownloadSelection};

    fn request() -> DownloadRequest {
        DownloadRequest {
            repo_url: "https://github.com/example/module".to_string(),
            expected_hash: Some("sha256".to_string()),
            dl_type: Some("release".to_string()),
            release_selection: Some(ReleaseDownloadSelection {
                tag_name: Some("v1.0.0".to_string()),
                compute_target: ReleaseComputeTarget::Cpu,
            }),
        }
    }

    #[test]
    fn resume_request_for_module_returns_stored_request() {
        let request = request();
        let resolved = resume_request_for_module("llamacpp", Some(request.clone())).unwrap();

        assert_eq!(resolved.repo_url, request.repo_url);
        assert_eq!(resolved.expected_hash, request.expected_hash);
        assert_eq!(resolved.dl_type, request.dl_type);
        assert_eq!(
            resolved
                .release_selection
                .map(|selection| selection.tag_name),
            Some(Some("v1.0.0".to_string()))
        );
    }

    #[test]
    fn resume_request_for_module_reports_missing_metadata() {
        let error = resume_request_for_module("llamacpp", None).unwrap_err();

        assert!(matches!(error, AppError::NotFound(_)));
        assert!(error.to_string().contains("llamacpp"));
    }

    #[test]
    fn list_regular_file_names_returns_sorted_files_only() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("zeta.toml"), "z").unwrap();
        std::fs::write(temp.path().join("alpha.toml"), "a").unwrap();
        std::fs::create_dir(temp.path().join("nested")).unwrap();

        let files = list_regular_file_names(temp.path()).unwrap();

        assert_eq!(files, vec!["alpha.toml", "zeta.toml"]);
    }

    #[test]
    fn list_regular_file_names_reports_missing_directory() {
        let temp = tempfile::tempdir().unwrap();
        let error = list_regular_file_names(&temp.path().join("missing")).unwrap_err();

        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[test]
    fn resolve_existing_module_dir_rejects_invalid_module_id() {
        let error = resolve_existing_module_dir("..\\escape").unwrap_err();

        assert!(matches!(error, AppError::Validation(_)));
    }
}
