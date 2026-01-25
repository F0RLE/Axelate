use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SelectedModule {
    pub id: String,
    pub name: String,
    #[serde(rename = "nameKey")]
    pub name_key: Option<String>,
    pub icon: String,
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(rename = "descKey")]
    pub desc_key: Option<String>,
    pub desc: String,
}

/// UI State that persists across sessions
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UIState {
    /// Sidebar collapsed state
    pub sidebar_collapsed: bool,
    /// Sidebar width in pixels
    pub sidebar_width: u32,
    /// Hidden navigation items (page IDs)
    pub hidden_nav_items: Vec<String>,
    /// Hidden system monitor items
    pub hidden_monitors: Vec<String>,
    /// Card widths map (card_id -> "full" | "half")
    pub card_widths: std::collections::HashMap<String, String>,
    /// Download settings
    pub download_limit_enabled: bool,
    pub download_max_speed: u32,
    /// Selected modules by category
    pub selected_modules: std::collections::HashMap<String, SelectedModule>,
}

impl Default for UIState {
    fn default() -> Self {
        Self {
            sidebar_collapsed: false,
            sidebar_width: 280,
            hidden_nav_items: Vec::new(),
            hidden_monitors: Vec::new(),
            card_widths: std::collections::HashMap::new(),
            download_limit_enabled: false,
            download_max_speed: 50,
            selected_modules: std::collections::HashMap::new(),
        }
    }
}
