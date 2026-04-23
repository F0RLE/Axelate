use crate::domain::modules::downloader;
use crate::domain::system::config_service::ConfigService;
use crate::errors::AppError;
use crate::models::config::AppConfig;

#[tauri::command]
#[specta::specta]
/// Loads application configuration with module installation status
pub async fn get_config(
    config_service: tauri::State<'_, std::sync::Arc<ConfigService>>,
) -> Result<AppConfig, AppError> {
    let mut config = config_service.load_full_config()?;

    // Populate installed status for each module
    for module in &mut config.catalog.ai {
        module.installed = downloader::is_module_installed(&module.id);
    }
    for module in &mut config.catalog.services {
        module.installed = downloader::is_module_installed(&module.id);
    }

    Ok(config)
}
