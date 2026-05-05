use crate::domain::system::config_repository::ConfigRepository;
use crate::errors::AppError;
use crate::models::config::{AiModel, ApiProvider, AppMeta, ModuleItem};
use crate::models::custom_models::CustomModelConfig;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Implementation of `ConfigRepository` that loads data from the local filesystem.
#[derive(Debug)]
pub struct FileConfigRepository;

impl FileConfigRepository {
    /// Creates a new `FileConfigRepository`.
    pub fn new(_app_handle: AppHandle) -> Self {
        Self
    }

    fn get_config_path(filename: &str) -> Result<PathBuf, AppError> {
        let res_dir = &*crate::utils::paths::RESOURCES_DIR;

        let candidates = [
            res_dir.join("config").join(filename),
            res_dir.join(filename),
            PathBuf::from("src-tauri/resources/config").join(filename),
            PathBuf::from("resources/config").join(filename),
            PathBuf::from("src-tauri/resources").join(filename),
            PathBuf::from("resources").join(filename),
        ];

        for path in &candidates {
            if path.exists() {
                return Ok(path.clone());
            }
        }

        Err(AppError::Config(format!(
            "Config file '{filename}' not found in any expected location"
        )))
    }

    fn get_resource_dir(dirname: &str) -> Option<PathBuf> {
        let res_dir = &*crate::utils::paths::RESOURCES_DIR;

        [
            res_dir.join(dirname),
            PathBuf::from("src-tauri/resources").join(dirname),
            PathBuf::from("resources").join(dirname),
        ]
        .into_iter()
        .find(|path| path.is_dir())
    }

    fn load_file_content(filename: &str, embedded: &str) -> String {
        if let Ok(path) = Self::get_config_path(filename) {
            std::fs::read_to_string(&path).unwrap_or_else(|e| {
                tracing::warn!("Failed to read {filename} from disk, using embedded: {e}");
                embedded.to_string()
            })
        } else {
            tracing::info!("{filename} not found on disk, using embedded.");
            embedded.to_string()
        }
    }

    fn load_file<T: serde::de::DeserializeOwned>(
        filename: &str,
        embedded: &str,
    ) -> Result<T, AppError> {
        let content = Self::load_file_content(filename, embedded);

        serde_json::from_str(&content)
            .map_err(|e| AppError::Config(format!("Failed to parse {filename}: {e}")))
    }

    fn load_custom_models_from_path(path: &Path) -> Result<CustomModelConfig, AppError> {
        let content = match std::fs::read_to_string(path) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(CustomModelConfig::default());
            }
            Err(error) => {
                return Err(AppError::Io(format!(
                    "Failed to read custom models config at {}: {error}",
                    path.display()
                )));
            }
        };

        serde_json::from_str(&content).map_err(|error| {
            AppError::Serialization(format!(
                "Failed to parse custom models config at {}: {error}",
                path.display()
            ))
        })
    }

    fn parse_api_providers(content: &str) -> Result<Vec<ApiProvider>, AppError> {
        let raw: serde_json::Value = serde_json::from_str(content)
            .map_err(|e| AppError::Config(format!("Failed to parse api_providers.json: {e}")))?;
        let providers = raw.as_array().ok_or_else(|| {
            AppError::Config("Failed to parse api_providers.json: expected array".to_string())
        })?;

        let mut parsed_providers = Vec::with_capacity(providers.len());
        for (index, provider) in providers.iter().cloned().enumerate() {
            if let Some(parsed) = Self::parse_api_provider(provider, index) {
                parsed_providers.push(parsed);
            }
        }

        Ok(parsed_providers)
    }

    fn load_api_provider_directory(root: &Path) -> Result<Vec<ApiProvider>, AppError> {
        let mut providers = Vec::new();

        for group in ["text", "image"] {
            let group_dir = root.join(group);
            if !group_dir.is_dir() {
                tracing::warn!(
                    "API provider group directory missing: {}",
                    group_dir.display()
                );
                continue;
            }

            let mut files = Self::list_json_files(&group_dir)?;
            files.sort();

            for file in files {
                match std::fs::read_to_string(&file) {
                    Ok(content) => {
                        if let Some(provider) = Self::parse_api_provider_file(&content, &file) {
                            providers.push(provider);
                        }
                    }
                    Err(error) => {
                        tracing::warn!("Skipping API provider file {}: {error}", file.display());
                    }
                }
            }
        }

        Ok(providers)
    }

    fn list_json_files(dir: &Path) -> Result<Vec<PathBuf>, AppError> {
        let entries = std::fs::read_dir(dir).map_err(|error| {
            AppError::Config(format!("Failed to read {}: {error}", dir.display()))
        })?;

        Ok(entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file()
                    && path
                        .extension()
                        .and_then(|extension| extension.to_str())
                        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
            })
            .collect())
    }

    fn parse_api_provider_file(content: &str, path: &Path) -> Option<ApiProvider> {
        let raw = match serde_json::from_str::<serde_json::Value>(content) {
            Ok(raw) => raw,
            Err(error) => {
                tracing::warn!("Skipping API provider file {}: {error}", path.display());
                return None;
            }
        };

        Self::parse_api_provider(raw, 0).or_else(|| {
            tracing::warn!("Skipping API provider file {}", path.display());
            None
        })
    }

    fn parse_api_provider(mut provider: serde_json::Value, index: usize) -> Option<ApiProvider> {
        let Some(provider_object) = provider.as_object_mut() else {
            tracing::warn!("Skipping API provider at index {index}: expected object");
            return None;
        };

        let raw_models = provider_object.remove("models");
        let mut parsed_provider = match serde_json::from_value::<ApiProvider>(provider) {
            Ok(provider) => provider,
            Err(error) => {
                tracing::warn!("Skipping API provider at index {index}: {error}");
                return None;
            }
        };

        if let Some(models) = raw_models {
            parsed_provider.models = Some(Self::parse_api_models(&parsed_provider.id, models));
        }

        Some(parsed_provider)
    }

    fn parse_api_models(provider_id: &str, models: serde_json::Value) -> Vec<AiModel> {
        let serde_json::Value::Array(raw_models) = models else {
            tracing::warn!("Skipping models for API provider {provider_id}: expected array");
            return Vec::new();
        };

        raw_models
            .into_iter()
            .enumerate()
            .filter_map(|(index, model)| match serde_json::from_value::<AiModel>(model) {
                Ok(model) => Some(model),
                Err(error) => {
                    tracing::warn!(
                        "Skipping API model at index {index} for provider {provider_id}: {error}"
                    );
                    None
                }
            })
            .collect()
    }
}

impl ConfigRepository for FileConfigRepository {
    fn load_app_meta(&self) -> Result<AppMeta, AppError> {
        Self::load_file(
            "app.json",
            include_str!("../../../resources/config/app.json"),
        )
    }

    fn load_api_providers(&self) -> Result<Vec<ApiProvider>, AppError> {
        if let Some(root) = Self::get_resource_dir("api_providers") {
            let providers = Self::load_api_provider_directory(&root)?;
            if !providers.is_empty() {
                return Ok(providers);
            }

            tracing::warn!(
                "No API providers loaded from {}, trying legacy api_providers.json",
                root.display()
            );
        }

        let content = Self::load_file_content("api_providers.json", "[]");

        Self::parse_api_providers(&content)
    }

    fn load_local_modules(&self) -> Result<Vec<ModuleItem>, AppError> {
        Self::load_file(
            "local_modules.json",
            include_str!("../../../resources/config/local_modules.json"),
        )
    }

    fn load_custom_models(&self) -> Result<CustomModelConfig, AppError> {
        let custom_path = crate::utils::paths::CONFIG_DIR.join("custom_models.json");
        Self::load_custom_models_from_path(&custom_path)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::FileConfigRepository;
    use crate::errors::AppError;
    use std::path::PathBuf;

    #[test]
    fn api_provider_parser_skips_invalid_models_without_dropping_catalog() -> Result<(), String> {
        let providers = FileConfigRepository::parse_api_providers(
            r#"
            [
                {
                    "id": "broken-provider",
                    "name": "Broken Provider",
                    "type": "api",
                    "models": [
                        {
                            "id": "good-model",
                            "name": "Good Model",
                            "desc": "Valid model",
                            "tier": "medium",
                            "stats": { "speed": 8, "logic": 8, "creative": 6 }
                        },
                        {
                            "id": "bad-model",
                            "name": "Bad Model",
                            "desc": "Invalid tier should not break the catalog",
                            "tier": "invalid",
                            "stats": { "speed": 8, "logic": 8, "creative": 6 }
                        }
                    ]
                },
                {
                    "id": "healthy-provider",
                    "name": "Healthy Provider",
                    "type": "api",
                    "models": []
                }
            ]
            "#,
        )
        .expect("provider list should parse");

        assert_eq!(providers.len(), 2);
        let broken_provider = providers
            .first()
            .ok_or_else(|| "broken provider".to_string())?;
        assert_eq!(broken_provider.id, "broken-provider");
        let models = broken_provider
            .models
            .as_ref()
            .ok_or_else(|| "models".to_string())?;
        assert_eq!(models.len(), 1);
        let model = models.first().ok_or_else(|| "model".to_string())?;
        assert_eq!(model.id, "good-model");

        let healthy_provider = providers
            .get(1)
            .ok_or_else(|| "healthy provider".to_string())?;
        assert_eq!(healthy_provider.id, "healthy-provider");
        Ok(())
    }

    #[test]
    fn api_provider_directory_skips_invalid_files_without_dropping_others() {
        let temp = tempfile::tempdir().expect("temp dir");
        let text_dir = temp.path().join("text");
        let image_dir = temp.path().join("image");
        std::fs::create_dir_all(&text_dir).expect("text dir");
        std::fs::create_dir_all(&image_dir).expect("image dir");

        std::fs::write(
            text_dir.join("good.json"),
            r#"{
                "id": "good-provider",
                "name": "Good Provider",
                "type": "api",
                "models": []
            }"#,
        )
        .expect("good provider");
        std::fs::write(
            text_dir.join("bad.json"),
            r#"{
                "id": "bad-provider",
                "name": "Bad Provider",
                "type": "api",
                "models": [
                    {
                        "id": "bad-model",
                        "name": "Bad Model",
                        "desc": "Invalid tier should not break other provider files",
                        "tier": "invalid",
                        "stats": { "speed": 8, "logic": 8, "creative": 6 }
                    }
                ]
            }"#,
        )
        .expect("bad provider");
        std::fs::write(image_dir.join("not-json.json"), "{").expect("bad json");

        let providers =
            FileConfigRepository::load_api_provider_directory(temp.path()).expect("providers");

        assert_eq!(providers.len(), 2);
        assert!(
            providers
                .iter()
                .any(|provider| provider.id == "good-provider")
        );
        assert!(providers.iter().any(|provider| {
            provider.id == "bad-provider"
                && provider
                    .models
                    .as_ref()
                    .is_some_and(std::vec::Vec::is_empty)
        }));
    }

    #[test]
    fn bundled_api_provider_directory_loads_text_and_image_providers() {
        let providers = FileConfigRepository::load_api_provider_directory(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("api_providers"),
        )
        .expect("bundled providers");

        assert!(providers.iter().any(|provider| {
            provider.capabilities.as_ref().is_none_or(|capabilities| {
                !capabilities.iter().any(|capability| capability == "image")
            })
        }));
        assert!(providers.iter().any(|provider| {
            provider.capabilities.as_ref().is_some_and(|capabilities| {
                capabilities.iter().any(|capability| capability == "image")
            })
        }));
    }

    #[test]
    fn custom_models_loader_defaults_only_when_file_is_missing() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let missing_path = temp_dir.path().join("custom_models.json");

        let config = FileConfigRepository::load_custom_models_from_path(&missing_path)
            .expect("missing custom models should default");

        assert!(config.models.is_empty());
    }

    #[test]
    fn custom_models_loader_parses_valid_json() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("custom_models.json");
        std::fs::write(
            &path,
            r#"{"models":[{"id":"custom-1","name":"Custom One","provider_id":"gpt","base_model_id":"gpt-4.1","created_at":1712345678.0}]}"#,
        )
        .expect("valid custom models fixture");

        let config = FileConfigRepository::load_custom_models_from_path(&path)
            .expect("valid custom models should parse");

        let model = config.models.first().expect("written custom model");
        assert_eq!(config.models.len(), 1);
        assert_eq!(model.id, "custom-1");
        assert_eq!(model.name, "Custom One");
        assert_eq!(model.provider_id, "gpt");
        assert_eq!(model.base_model_id, "gpt-4.1");
        assert!((model.created_at - 1_712_345_678.0).abs() < f64::EPSILON);
    }

    #[test]
    fn custom_models_loader_reports_invalid_json() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("custom_models.json");
        std::fs::write(&path, "{broken").expect("broken custom models fixture");

        let error = FileConfigRepository::load_custom_models_from_path(&path)
            .expect_err("invalid custom models should not default");

        assert!(matches!(
            error,
            AppError::Serialization(message) if message.contains("custom_models.json")
        ));
    }
}
