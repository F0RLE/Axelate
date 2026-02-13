use crate::domain::modules::downloader;
use crate::domain::system::config_service::ConfigService;
use crate::errors::AppError;
use crate::infrastructure::config::config_repository::FileConfigRepository;
use crate::models::config::AppConfig;
use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
/// Loads application configuration with module installation status
pub async fn get_config(app: AppHandle) -> Result<AppConfig, AppError> {
    let repo = FileConfigRepository::new(app);
    let service = ConfigService::new(Box::new(repo));

    let mut config = service.load_full_config()?;

    // Populate installed status for each module
    for module in &mut config.catalog.ai {
        module.installed = downloader::is_module_installed(&module.id);
    }
    for module in &mut config.catalog.services {
        module.installed = downloader::is_module_installed(&module.id);
    }

    Ok(config)
}
