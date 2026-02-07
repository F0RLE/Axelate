/// AI Provider commands for chat and model management
pub mod ai;
/// Configuration management commands
pub mod config;
/// Module download and management commands
pub mod downloader;
/// Backend health check commands
pub mod health;
/// License activation and validation commands
pub mod license;
/// Frontend logging commands
pub mod logs;
/// Application module lifecycle commands
pub mod modules;
/// Secure storage encryption commands
pub mod secure;
/// Application settings persistence commands
pub mod settings;
/// System information and hardware stats commands
pub mod system;
/// Theme and color scheme commands
pub mod theme;
/// Internationalization and translation commands
pub mod translations;
/// UI state persistence commands
pub mod ui_state;
/// Window management commands (minimize, maximize, hide)
pub mod window;
/// Window settings and positioning commands
pub mod window_settings;

pub use ai::*;
pub use downloader::*;
pub use health::*;
pub use license::*;
pub use logs::*;
pub use modules::*;
pub use secure::*;
pub use settings::*;
pub use system::*;
pub use translations::*;
pub use ui_state::*;
pub use window::*;
pub use window_settings::*; // Added
/// Bootstrap initialization commands
pub mod bootstrap;
pub use bootstrap::*;
