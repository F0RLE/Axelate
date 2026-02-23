use crate::errors::AppError;

/// Retrieves translation strings for the specified language.
///
/// Falls back to English for unknown languages. Logs a warning if a
/// translation file fails to parse.
pub fn get_translations(lang: &str) -> Result<serde_json::Value, AppError> {
    let base_content = include_str!("../../../resources/locales/en.json");
    let mut translations: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(base_content).map_err(|e| AppError::Serialization(e.to_string()))?;

    if lang != "en" {
        let target_content = match lang {
            "ru" => Some(include_str!("../../../resources/locales/ru.json")),
            "zh" => Some(include_str!("../../../resources/locales/zh.json")),
            _ => None,
        };

        if let Some(content) = target_content {
            match serde_json::from_str::<serde_json::Value>(content) {
                Ok(target_json) => {
                    if let Some(target_map) = target_json.as_object() {
                        for (k, v) in target_map {
                            translations.insert(k.clone(), v.clone());
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("Failed to parse {lang} translations, using English: {e}");
                }
            }
        }
    }

    Ok(serde_json::Value::Object(translations))
}
