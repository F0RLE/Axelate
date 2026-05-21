use serde::{Deserialize, Serialize};
use specta::Type;

/// Currently selected module in UI
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct SelectedModule {
    /// Module identifier
    pub id: String,
    /// Display name
    pub name: String,
    /// Localization key for name
    #[serde(rename = "nameKey")]
    pub name_key: Option<String>,
    /// Icon/emoji
    pub icon: String,
    /// Module type
    #[serde(rename = "type")]
    pub type_: String,
    /// Localization key for description
    #[serde(rename = "descKey")]
    pub desc_key: Option<String>,
    /// Description text
    pub desc: String,
}

/// UI State that persists across sessions
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct UIState {
    /// Sidebar collapsed state
    pub sidebar_collapsed: bool,
    /// User manually overrode responsive sidebar compaction
    #[serde(default)]
    pub sidebar_manual_override: bool,
    /// Sidebar width in pixels
    pub sidebar_width: u32,
    /// Hidden navigation items (page IDs)
    pub hidden_nav_items: Vec<String>,
    /// Hidden system monitor items
    pub hidden_monitors: Vec<String>,
    /// Card widths map (`card_id` -> "full" | "half")
    pub card_widths: std::collections::HashMap<String, String>,
    /// Download settings
    pub download_limit_enabled: bool,
    /// Maximum download speed in MB/s
    pub download_max_speed: u32,
    /// Selected modules by category
    pub selected_modules: std::collections::HashMap<String, SelectedModule>,
    /// Global Zoom Level
    pub zoom_level: f64,
    /// Selected AI Models (`AppID` -> `ModelKey`)
    pub selected_ai_models: std::collections::HashMap<String, String>,
    /// Last visited page ID
    pub last_page: Option<String>,
    /// Per-resolution zoom levels ("WxH" -> value)
    /// Per-resolution zoom levels (e.g., "1920x1080" -> 1.2)
    pub resolution_zoom: std::collections::HashMap<String, f64>,
    /// Sound effects enabled state
    pub sound_enabled: bool,
    /// Selected reasoning level by AI provider
    #[serde(default)]
    pub ai_thinking_level: std::collections::HashMap<String, String>,
    /// Enables provider-side internet search by AI provider
    #[serde(default)]
    pub ai_web_search_enabled: std::collections::HashMap<String, bool>,
    /// Current persistent AI session identifier
    #[serde(default)]
    pub ai_session_id: Option<String>,
    /// Preferred launcher interface language
    #[serde(default)]
    pub preferred_language: Option<String>,
    /// Request to reopen the chat and reveal the latest message after background work.
    #[serde(default)]
    pub pending_chat_reveal: bool,
}

impl Default for UIState {
    fn default() -> Self {
        Self {
            sidebar_collapsed: false,
            sidebar_manual_override: false,
            sidebar_width: 280,
            hidden_nav_items: Vec::new(),
            hidden_monitors: Vec::new(),
            card_widths: std::collections::HashMap::new(),
            download_limit_enabled: false,
            download_max_speed: 50,
            selected_modules: std::collections::HashMap::new(),
            zoom_level: 1.0,
            selected_ai_models: std::collections::HashMap::new(),
            last_page: None,
            resolution_zoom: std::collections::HashMap::new(),
            sound_enabled: true,
            ai_thinking_level: std::collections::HashMap::new(),
            ai_web_search_enabled: std::collections::HashMap::new(),
            ai_session_id: None,
            preferred_language: None,
            pending_chat_reveal: false,
        }
    }
}
