use crate::errors::AppError;
use std::borrow::Cow;
use std::path::Path;
use tauri::AppHandle;

const EN_TRANSLATIONS: &str = include_str!("../../../resources/locales/en.json");
const RU_TRANSLATIONS: &str = include_str!("../../../resources/locales/ru.json");
const ZH_TRANSLATIONS: &str = include_str!("../../../resources/locales/zh.json");

/// Retrieves translation strings for the specified language
pub fn get_translations(_app: &AppHandle, lang: &str) -> Result<serde_json::Value, AppError> {
    let base_content = load_locale_content("en");
    let mut translations: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&base_content).map_err(|e| AppError::Serialization(e.to_string()))?;

    if lang != "en" {
        let target_content = match lang {
            "ru" => Some(load_locale_content("ru")),
            "zh" => Some(load_locale_content("zh")),
            _ => None,
        };

        if let Some(content) = target_content {
            match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(target_json) => {
                    if let Some(target_map) = target_json.as_object() {
                        for (k, v) in target_map {
                            translations.insert(k.clone(), v.clone());
                        }
                    } else {
                        tracing::warn!(
                            "Locale '{lang}' root is not a JSON object; using English fallbacks"
                        );
                    }
                }
                Err(error) => {
                    tracing::warn!(
                        "Failed to parse locale '{lang}', using English fallbacks: {error}"
                    );
                }
            }
        }
    }

    Ok(serde_json::Value::Object(translations))
}

fn load_locale_content(lang: &str) -> Cow<'static, str> {
    let (relative_path, fallback) = match lang {
        "ru" => ("resources/locales/ru.json", RU_TRANSLATIONS),
        "zh" => ("resources/locales/zh.json", ZH_TRANSLATIONS),
        _ => ("resources/locales/en.json", EN_TRANSLATIONS),
    };

    load_dev_text_resource(relative_path, fallback)
}

fn load_dev_text_resource(relative_path: &str, fallback: &'static str) -> Cow<'static, str> {
    #[cfg(debug_assertions)]
    {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative_path);
        if let Ok(content) = std::fs::read_to_string(path) {
            return Cow::Owned(content);
        }
    }

    Cow::Borrowed(fallback)
}

/// Returns the path to locales directory
pub fn get_locales_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    get_locales_dir_impl(app)
}

#[cfg(debug_assertions)]
fn get_locales_dir_impl(_app: &tauri::AppHandle) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/locales")
}

#[cfg(not(debug_assertions))]
fn get_locales_dir_impl(app: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    app.path()
        .resource_dir()
        .unwrap_or_default()
        .join("resources/locales")
}
