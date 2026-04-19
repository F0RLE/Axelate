/// Canonical language codes currently supported by the UI.
const DEFAULT_LANGUAGE: &str = "en";

/// Converts an arbitrary locale or language tag into a supported UI language.
#[must_use]
pub fn normalize_supported_language(language: &str) -> &'static str {
    let lower = language.trim().to_ascii_lowercase();
    if lower.starts_with("ru") {
        "ru"
    } else if lower.starts_with("zh") {
        "zh"
    } else {
        DEFAULT_LANGUAGE
    }
}

/// Detects the OS locale and normalizes it to a supported UI language.
#[must_use]
pub fn detect_system_language() -> String {
    sys_locale::get_locale()
        .as_deref()
        .map_or(DEFAULT_LANGUAGE, normalize_supported_language)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{detect_system_language, normalize_supported_language};

    #[test]
    fn normalize_supported_language_maps_known_prefixes() {
        assert_eq!(normalize_supported_language("ru-RU"), "ru");
        assert_eq!(normalize_supported_language("zh_CN"), "zh");
        assert_eq!(normalize_supported_language("en-US"), "en");
        assert_eq!(normalize_supported_language("de-DE"), "en");
    }

    #[test]
    fn detect_system_language_returns_supported_code() {
        let lang = detect_system_language();

        assert!(matches!(lang.as_str(), "en" | "ru" | "zh"));
    }
}
