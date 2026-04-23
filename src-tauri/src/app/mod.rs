//! App-level setup modules
//!
//! Centralizes window management and system tray setup, keeping `lib.rs` focused
//! on wiring together Tauri plugins, state, and the main `run()` entry point.

use std::sync::atomic::AtomicBool;

/// Global quit flag — set to `true` when the user explicitly selects "Quit"
/// from the tray menu, allowing `RunEvent::ExitRequested` to proceed.
pub static IS_QUITTING: AtomicBool = AtomicBool::new(false);

/// System tray icon and menu event handling
pub mod tray;
/// Window management: creation, shortcut registration, cache isolation
pub mod window;
