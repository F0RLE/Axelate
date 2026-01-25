// Windows-specific utilities for language detection and system info

#[cfg(windows)]
use windows_sys::Win32::Globalization::GetUserDefaultUILanguage;

/// Detect system UI language using Windows API
/// Returns language code: "ru", "zh", or "en" (default)
pub fn detect_system_language() -> String {
    #[cfg(windows)]
    {
        // SAFETY: GetUserDefaultUILanguage is a safe Windows API call
        let lcid = unsafe { GetUserDefaultUILanguage() };
        let lang_id = lcid & 0x3FF;

        match lang_id {
            0x19 => "ru".to_string(), // Russian
            0x04 => "zh".to_string(), // Chinese
            0x09 => "en".to_string(), // English
            0x07 => "de".to_string(), // German
            0x0C => "fr".to_string(), // French
            0x0A => "es".to_string(), // Spanish
            0x11 => "ja".to_string(), // Japanese
            0x12 => "ko".to_string(), // Korean
            _ => "en".to_string(),    // Default to English
        }
    }

    #[cfg(not(windows))]
    {
        // Fallback for non-Windows platforms
        std::env::var("LANG")
            .ok()
            .and_then(|lang| lang.split('_').next().map(|s| s.to_lowercase()))
            .unwrap_or_else(|| "en".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_language() {
        let lang = detect_system_language();
        // Should return a valid language code
        assert!(!lang.is_empty());
        assert!(lang.len() == 2);
        println!("Detected system language: {}", lang);
    }
}
