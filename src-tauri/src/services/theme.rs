use std::collections::HashMap;

pub fn get_theme_colors() -> HashMap<String, String> {
    let mut colors = HashMap::new();

    // Backgrounds
    colors.insert("bg_dark".to_string(), "#111015".to_string());
    colors.insert("bg_med".to_string(), "#1a1920".to_string());
    colors.insert("bg_light".to_string(), "#26252d".to_string());
    colors.insert("surface".to_string(), "#31303a".to_string());
    colors.insert("surface_light".to_string(), "#3A3942".to_string());

    // Borders
    colors.insert("border".to_string(), "#31303a".to_string());
    colors.insert("border_color".to_string(), "#31303a".to_string());
    colors.insert("border_focus".to_string(), "#8a2be2".to_string());

    // Primary (Violet)
    colors.insert("primary".to_string(), "#8a2be2".to_string());
    colors.insert("primary_light".to_string(), "#9d4edd".to_string());
    colors.insert("primary_dark".to_string(), "#7b2cbf".to_string());
    colors.insert("primary_hover".to_string(), "#9d4edd".to_string());

    // Status
    colors.insert("success".to_string(), "#28a745".to_string());
    colors.insert("danger".to_string(), "#dc3545".to_string());
    colors.insert("warning".to_string(), "#ffc107".to_string());

    // Text
    colors.insert("text".to_string(), "#e0e0e0".to_string());
    colors.insert("text_primary".to_string(), "#e0e0e0".to_string());
    colors.insert("text_secondary".to_string(), "#a0a0a0".to_string());
    colors.insert("text_muted".to_string(), "#6c757d".to_string());
    colors.insert("secondary".to_string(), "#a0a0a0".to_string());

    // Legacy aliases
    colors.insert("bg".to_string(), "#111015".to_string());
    colors.insert("sidebar".to_string(), "#1a1920".to_string());
    colors.insert("input_bg".to_string(), "#26252d".to_string());
    colors.insert("hover".to_string(), "#31303a".to_string());
    colors.insert("card_bg".to_string(), "#1a1920".to_string());

    colors
}
