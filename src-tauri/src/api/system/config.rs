use crate::domain::modules::downloader;
use crate::errors::AppError;
use crate::infrastructure::config::config_service;
use crate::models::config::AppConfig;
use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
/// Loads application configuration with module installation status
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
