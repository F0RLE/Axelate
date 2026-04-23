use serde::{Deserialize, Serialize};
use specta::Type;

/// Global application settings
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct AppSettings {
    /// UI theme ("dark" or "light")
    pub theme: String,
    /// Interface language code (e.g., "en", "ru", "zh")
    pub language: String,
    /// Enable GPU acceleration for monitoring
    pub use_gpu: bool,
    /// Enable debug mode and logging
    pub debug_mode: bool,
    /// Dynamic extra settings (module-specific, etc.)
    #[serde(flatten)]
    pub extra_settings: std::collections::HashMap<String, String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            language: crate::utils::locale::detect_system_language(),
            use_gpu: true,
            debug_mode: false,
            extra_settings: std::collections::HashMap::new(),
        }
    }
}
