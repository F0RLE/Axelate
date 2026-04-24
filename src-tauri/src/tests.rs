//! Unit tests for Axelate backend
//!
//! Run with: cargo test

#[cfg(test)]
mod app_tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]
    use crate::models::AppSettings;

    /// Test default settings values
    #[test]
    fn test_default_settings() {
        let settings = AppSettings::default();

        assert_eq!(settings.theme, "dark");
        assert_eq!(
            settings.language,
            crate::utils::locale::detect_system_language()
        );
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
            ..Default::default()
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
    fn test_data_roots_initialized() {
        use crate::utils::paths::APPDATA_ROOT;

        let path_str = APPDATA_ROOT.to_string_lossy().replace('\\', "/");
        assert!(
            path_str.contains("/axelate-tests/") && path_str.ends_with("/roaming"),
            "APPDATA_ROOT should use a temp test roaming root, got {path_str}"
        );
    }

    /// Test directory paths are correctly derived
    #[test]
    fn test_directory_paths() {
        use crate::utils::paths::{
            CONFIG_DIR, ENGINE_LOGS_DIR, LOG_DIR, MODELS_DIR, MODULE_LOGS_DIR, RUNTIME_DIR,
            SYSTEM_ROOT, USER_ROOT,
        };

        // Verify all derived paths are rooted under the expected test directories.
        assert!(USER_ROOT.starts_with(crate::utils::paths::APPDATA_ROOT.as_path()));
        assert!(USER_ROOT.ends_with("User"));

        // Verify CONFIG_DIR is under USER_ROOT.
        assert!(CONFIG_DIR.starts_with(USER_ROOT.as_path()));
        assert!(CONFIG_DIR.ends_with("Configs"));

        // Verify SYSTEM_ROOT and its descendants use the roaming app-data root.
        assert!(SYSTEM_ROOT.starts_with(crate::utils::paths::APPDATA_ROOT.as_path()));
        assert!(SYSTEM_ROOT.ends_with("System"));
        assert!(LOG_DIR.starts_with(SYSTEM_ROOT.as_path()));
        assert!(LOG_DIR.ends_with("Logs"));
        assert!(ENGINE_LOGS_DIR.starts_with(LOG_DIR.as_path()));
        assert!(ENGINE_LOGS_DIR.ends_with("Engines"));
        assert!(MODULE_LOGS_DIR.starts_with(LOG_DIR.as_path()));
        assert!(MODULE_LOGS_DIR.ends_with("Modules"));
        assert!(MODELS_DIR.starts_with(SYSTEM_ROOT.as_path()));
        assert!(MODELS_DIR.ends_with("Models"));
        assert!(RUNTIME_DIR.starts_with(SYSTEM_ROOT.as_path()));
        assert!(RUNTIME_DIR.ends_with("Runtime"));
    }

    /// Test file paths are correctly derived
    #[test]
    fn test_file_paths() {
        use crate::utils::paths::{FILE_APP_SETTINGS, FILE_GEN_CONFIG};

        assert!(
            FILE_APP_SETTINGS
                .to_string_lossy()
                .ends_with("app_settings.json")
        );
        assert!(
            FILE_GEN_CONFIG
                .to_string_lossy()
                .ends_with("generation_config.json")
        );
    }
}

#[cfg(test)]
mod error_tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]
    use crate::errors::{AppError, IpcError};

    /// Test AppError::Validation → IpcError mapping
    #[test]
    fn test_validation_error_to_ipc() {
        let err = AppError::Validation("invalid input".to_string());
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, "VALIDATION");
        assert_eq!(ipc.message, "invalid input");
    }

    /// Test AppError::NotFound → IpcError mapping
    #[test]
    fn test_not_found_error_to_ipc() {
        let err = AppError::NotFound("settings.json".to_string());
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, "NOT_FOUND");
        assert_eq!(ipc.message, "settings.json");
    }

    /// Test AppError::PermissionDenied → IpcError mapping
    #[test]
    fn test_permission_denied_error_to_ipc() {
        let err = AppError::PermissionDenied("admin required".to_string());
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, "PERMISSION_DENIED");
        assert_eq!(ipc.message, "admin required");
    }

    /// Test AppError::Io → IpcError mapping
    #[test]
    fn test_io_error_to_ipc() {
        let err = AppError::Io("disk full".to_string());
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, "IO_ERROR");
        assert_eq!(ipc.message, "disk full");
    }

    /// Test AppError::Serialization → IpcError mapping
    #[test]
    fn test_serialization_error_to_ipc() {
        let err = AppError::Serialization("invalid JSON".to_string());
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, "SERIALIZATION");
        assert_eq!(ipc.message, "invalid JSON");
    }

    /// Test AppError::Config → IpcError mapping
    #[test]
    fn test_config_error_to_ipc() {
        let err = AppError::Config("missing field".to_string());
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, "CONFIG");
        assert_eq!(ipc.message, "missing field");
    }

    /// Test AppError::External → IpcError mapping (with request_id)
    #[test]
    fn test_external_error_to_ipc() {
        let err = AppError::External {
            request_id: Some("req-123".to_string()),
            message: "API timeout".to_string(),
        };
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, "EXTERNAL");
        assert_eq!(ipc.message, "API timeout");
    }

    /// Test AppError::Internal → IpcError mapping (without request_id)
    #[test]
    fn test_internal_error_to_ipc() {
        let err = AppError::Internal {
            request_id: None,
            message: "unexpected state".to_string(),
        };
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, "INTERNAL");
        assert_eq!(ipc.message, "unexpected state");
    }

    /// Test std::io::Error → AppError conversion
    #[test]
    fn test_io_std_error_to_app_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let app_err: AppError = io_err.into();
        assert!(matches!(app_err, AppError::Io(_)));
        assert!(app_err.to_string().contains("file missing"));
    }

    /// Test serde_json::Error → AppError conversion
    #[test]
    fn test_serde_json_error_to_app_error() {
        let result: Result<serde_json::Value, _> = serde_json::from_str("{invalid}");
        let serde_err = result.unwrap_err();
        let app_err: AppError = serde_err.into();
        assert!(matches!(app_err, AppError::Serialization(_)));
    }

    /// Test Display trait for all variants
    #[test]
    fn test_app_error_display() {
        assert_eq!(
            AppError::Validation("bad".to_string()).to_string(),
            "Validation error: bad"
        );
        assert_eq!(
            AppError::NotFound("x".to_string()).to_string(),
            "Not found: x"
        );
        assert_eq!(
            AppError::Io("fail".to_string()).to_string(),
            "IO error: fail"
        );
        assert_eq!(
            AppError::External {
                request_id: None,
                message: "down".to_string()
            }
            .to_string(),
            "External error: down"
        );
        assert_eq!(
            AppError::Internal {
                request_id: Some("r1".to_string()),
                message: "boom".to_string()
            }
            .to_string(),
            "Internal error: boom"
        );
    }
}
