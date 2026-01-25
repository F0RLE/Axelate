//! Unit tests for Flux Platform backend
//!
//! Run with: cargo test

#[cfg(test)]
mod tests {
    use crate::models::AppSettings;

    /// Test default settings values
    #[test]
    fn test_default_settings() {
        let settings = AppSettings::default();

        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.language, "ru");
        assert!(settings.use_gpu);
        assert!(!settings.debug_mode);
    }

    /// Test settings serialization
    #[test]
    fn test_settings_serialization() {
        let settings = AppSettings {
            theme: "light".to_string(),
            language: "en".to_string(),
            use_gpu: false,
            debug_mode: true,
        };

        let json = serde_json::to_string(&settings).expect("Failed to serialize");
        assert!(json.contains("\"theme\":\"light\""));
        assert!(json.contains("\"language\":\"en\""));
        assert!(json.contains("\"use_gpu\":false"));
        assert!(json.contains("\"debug_mode\":true"));
    }

    /// Test settings deserialization
    #[test]
    fn test_settings_deserialization() {
        let json = r#"{"theme":"dark","language":"zh","use_gpu":true,"debug_mode":false}"#;
        let settings: AppSettings = serde_json::from_str(json).expect("Failed to deserialize");

        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.language, "zh");
        assert!(settings.use_gpu);
        assert!(!settings.debug_mode);
    }

    /// Test settings clone
    #[test]
    fn test_settings_clone() {
        let original = AppSettings::default();
        let cloned = original.clone();

        assert_eq!(original.theme, cloned.theme);
        assert_eq!(original.language, cloned.language);
        assert_eq!(original.use_gpu, cloned.use_gpu);
        assert_eq!(original.debug_mode, cloned.debug_mode);
    }

    /// Test path utilities are initialized
    #[test]
    fn test_appdata_root_initialized() {
        use crate::utils::paths::APPDATA_ROOT;

        // Verify path ends with FluxData
        let path_str = APPDATA_ROOT.to_string_lossy();
        assert!(
            path_str.ends_with("FluxData"),
            "APPDATA_ROOT should end with FluxData"
        );
    }

    /// Test directory paths are correctly derived
    #[test]
    fn test_directory_paths() {
        use crate::utils::paths::{CONFIG_DIR, LOG_DIR, SYSTEM_ROOT, USER_ROOT};

        // Verify USER_ROOT is under APPDATA_ROOT
        assert!(USER_ROOT.to_string_lossy().contains("FluxData"));
        assert!(USER_ROOT.to_string_lossy().contains("User"));

        // Verify CONFIG_DIR is under USER_ROOT
        assert!(CONFIG_DIR.to_string_lossy().contains("Configs"));

        // Verify SYSTEM_ROOT and LOG_DIR
        assert!(SYSTEM_ROOT.to_string_lossy().contains("System"));
        assert!(LOG_DIR.to_string_lossy().contains("Logs"));
    }

    /// Test file paths are correctly derived
    #[test]
    fn test_file_paths() {
        use crate::utils::paths::{FILE_ENV, FILE_GEN_CONFIG};

        assert!(FILE_ENV.to_string_lossy().ends_with(".env"));
        assert!(FILE_GEN_CONFIG
            .to_string_lossy()
            .ends_with("generation_config.json"));
    }
}
