use crate::errors::AppError;
use crate::models::config::{ApiProvider, AppConfig};

/// Trait for loading        // Initialize config.models if empty lists (if applicable) or just proceed
pub trait ConfigRepository: std::fmt::Debug + Send + Sync {
    /// Loads the default application configuration.
    fn load_defaults(&self) -> Result<AppConfig, AppError>;

    /// Loads the list of AI API providers.
    fn load_providers(&self) -> Result<Vec<ApiProvider>, AppError>;
}
