use crate::errors::AppError;
use crate::services::config_service::{self, AppConfig};
use crate::services::downloader;
use tauri::AppHandle;

#[tauri::command]
pub async fn get_config(app: AppHandle) -> Result<AppConfig, AppError> {
    let mut config = config_service::load_config(&app)?;

    // Populate installed status for each module
    for module in &mut config.catalog.ai {
        module.installed = downloader::is_module_installed(&module.id);
    }
    for module in &mut config.catalog.services {
        module.installed = downloader::is_module_installed(&module.id);
    }

    Ok(config)
}
