use crate::services::downloader;
use tauri::AppHandle;

#[tauri::command]
pub async fn download_module(
    app: AppHandle,
    module_id: String,
    repo_url: String,
    expected_hash: Option<String>,
) -> Result<(), String> {
    downloader::download_module(app, module_id, repo_url, expected_hash).await
}

#[tauri::command]
pub fn check_module_installed(module_id: String) -> bool {
    downloader::is_module_installed(&module_id)
}

#[tauri::command]
pub fn get_module_path(module_id: String) -> Result<String, String> {
    downloader::validate_module_id(&module_id).map_err(|e| e.to_string())?;

    Ok(downloader::get_module_path(&module_id)
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub fn delete_module(module_id: String) -> Result<(), String> {
    downloader::delete_module(&module_id)
}

#[tauri::command]
pub async fn list_module_files(module_id: String) -> Result<Vec<String>, String> {
    downloader::validate_module_id(&module_id).map_err(|e| e.to_string())?;

    let path = downloader::get_module_path(&module_id);
    if !path.exists() {
        return Err("Module directory does not exist".to_string());
    }

    let entries =
        std::fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

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
