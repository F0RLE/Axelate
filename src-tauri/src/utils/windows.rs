// Windows-specific utilities for language detection and system info
#![allow(unsafe_code)]

#[cfg(all(windows, not(test)))]
use windows_sys::Win32::Globalization::GetUserDefaultUILanguage;

#[cfg(not(windows))]
fn normalize_supported_language(language: &str) -> String {
    let lower = language.trim().to_ascii_lowercase();
    if lower.starts_with("ru") {
        "ru".to_string()
    } else if lower.starts_with("zh") {
        "zh".to_string()
    } else {
        "en".to_string()
    }
}

/// Detect system UI language using Windows API
/// Returns language code: "ru", "zh", or "en" (default)
pub fn detect_system_language() -> String {
    #[cfg(all(windows, not(test)))]
    {
        // SAFETY: GetUserDefaultUILanguage is a safe Windows API call
        let lcid = unsafe { GetUserDefaultUILanguage() };
        let lang_id = lcid & 0x3FF;

        match lang_id {
            0x19 => "ru".to_string(), // Russian
            0x04 => "zh".to_string(), // Chinese
            _ => "en".to_string(),    // English (default)
        }
    }

    #[cfg(test)]
    {
        "en".to_string()
    }

    #[cfg(not(windows))]
    {
        std::env::var("LC_ALL")
            .or_else(|_| std::env::var("LANG"))
            .map(|lang| normalize_supported_language(&lang))
            .unwrap_or_else(|_| "en".to_string())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::print_stdout)]
    use super::*;

    #[test]
    fn test_detect_language() {
        let lang = detect_system_language();
        // Should return a valid language code
        assert!(!lang.is_empty());
        assert!(lang.len() == 2);
        println!("Detected system language: {lang}");
    }
}
