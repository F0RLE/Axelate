// Windows-specific utilities for language detection and system info
#![allow(unsafe_code)]

#[cfg(all(windows, not(test)))]
use windows_sys::Win32::Globalization::GetUserDefaultUILanguage;

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
            0x07 => "de".to_string(), // German
            0x0C => "fr".to_string(), // French
            0x0A => "es".to_string(), // Spanish
            0x11 => "ja".to_string(), // Japanese
            0x12 => "ko".to_string(), // Korean
            _ => "en".to_string(),    // English (default)
        }
    }

    #[cfg(any(not(windows), test))]
    {
        "en".to_string()
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
