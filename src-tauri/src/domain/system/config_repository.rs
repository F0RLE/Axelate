use crate::errors::AppError;
use crate::models::config::{ApiProvider, AppMeta, ModuleItem};

/// Trait for loading application configuration sources.
pub trait ConfigRepository: std::fmt::Debug + Send + Sync {
    /// Loads the base application metadata.
    fn load_app_meta(&self) -> Result<AppMeta, AppError>;

    /// Loads the list of AI API providers.
    fn load_api_providers(&self) -> Result<Vec<ApiProvider>, AppError>;

    /// Loads the list of local modules.
    fn load_local_modules(&self) -> Result<Vec<ModuleItem>, AppError>;

    /// Loads custom models
    fn load_custom_models(
        &self,
    ) -> Result<crate::models::custom_models::CustomModelConfig, AppError>;
}
