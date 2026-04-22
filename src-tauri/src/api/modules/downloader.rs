use crate::domain::modules::downloader;
use crate::errors::AppError;
use tauri::AppHandle;

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
) -> Result<(), AppError> {
    downloader::download_module(
        app,
        &downloader,
        module_id,
        repo_url,
        expected_hash,
        dl_type,
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
/// Resolves the module-owned settings UI entry file path for asset loading.
pub async fn get_module_settings_ui_entry_path(module_id: String) -> Result<String, AppError> {
    Ok(
        crate::domain::modules::settings_ui::resolve_module_settings_ui_entry_path(&module_id)
            .await?
            .to_string_lossy()
            .to_string(),
    )
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
    if !path.exists() {
        return Err(AppError::NotFound(
            "Module directory does not exist".to_string(),
        ));
    }

    let entries = std::fs::read_dir(path)?;

    let mut files = Vec::new();
    for entry in entries.flatten() {
        if let Ok(file_type) = entry.file_type()
            && file_type.is_file()
        {
            files.push(entry.file_name().to_string_lossy().to_string());
        }
    }

    Ok(files)
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
