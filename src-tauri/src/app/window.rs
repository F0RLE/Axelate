//! App-level window management
//!
//! Handles WebView2 cache isolation, global shortcuts, and window
//! creation / restoration from saved state.

use crate::api::settings::window_settings::{res_key_from_window, resolve_zoom};
use crate::domain::monitoring::system_monitor;
use crate::infrastructure::config::{
    ui_state as infra_ui_state, window_settings as infra_window_settings,
};
use tauri::Manager;

// ==================================================================================
// Helpers
// ==================================================================================

/// Shows, unminimizes, and focuses an existing window.
pub fn show_and_focus_window(window: &tauri::WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// Configures the WebView2 user data folder to isolate cache.
#[allow(unsafe_code)]
pub fn setup_webview2_cache() {
    if let Ok(app_data) = std::env::var("APPDATA") {
        let mut path = std::path::PathBuf::from(app_data);
        path.push("AxelateData");
        path.push("Cache");
        path.push("com.axelate");
        if let Err(e) = std::fs::create_dir_all(&path) {
            tracing::error!("Failed to create custom data directory: {e}");
        } else if !path.as_os_str().is_empty() {
            unsafe {
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &path);
            }
        }
    }
}

/// Registers the Ctrl+Space global shortcut for window toggling.
#[cfg(desktop)]
pub fn setup_global_shortcut(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_shortcut("Ctrl+Space")?
            .with_handler(move |app, shortcut, event| {
                if event.state == ShortcutState::Pressed
                    && shortcut.matches(Modifiers::CONTROL, Code::Space)
                {
                    if let Some(window) = app.get_webview_window("main") {
                        tracing::info!("Ctrl+Space pressed. Toggling existing window.");
                        let is_visible: bool = window.is_visible().unwrap_or(false);
                        let is_focused: bool = window.is_focused().unwrap_or(false);

                        if is_visible && is_focused {
                            let _ = window.minimize();
                            system_monitor::set_paused(true);
                            crate::utils::memory::trim_memory();
                        } else {
                            show_and_focus_window(&window);
                            system_monitor::set_paused(false);
                        }
                    } else {
                        tracing::debug!("Ctrl+Space pressed but WebView is dead. Ignoring.");
                    }
                }
            })
            .build(),
    )?;
    Ok(())
}

/// Orchestrates the creation or restoration of the primary application window.
///
/// Retrieves serialized window state to preserve user context across sessions.
pub fn create_main_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    // 1. Check if window already exists
    if let Some(window) = app.get_webview_window("main") {
        return Some(window);
    }

    // 2. Load saved settings for "cold start" restoration
    let settings = infra_window_settings::load_window_settings();

    // 3. Create the window
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Axelate (Beta)")
    .resizable(true)
    .fullscreen(false)
    .transparent(false)
    .visible(false) // Start invisible to avoid flicker while moving/resizing
    .decorations(false) // Custom titlebar
    .inner_size(f64::from(settings.width), f64::from(settings.height));

    // Restore position if valid
    if let (Some(x), Some(y)) = (settings.x, settings.y) {
        builder = builder.position(f64::from(x), f64::from(y));
    }

    // Attempt to build
    match builder.build() {
        Ok(window) => {
            // 4. Apply zoom using canonical priority chain:
            //    per-resolution saved > global zoom_level > 1.0
            let ui_state = infra_ui_state::get_ui_state_sync();
            let res_key = res_key_from_window(&window).unwrap_or_else(|| "unknown".to_string());
            let zoom = resolve_zoom(&ui_state, &res_key);

            if (zoom - 1.0).abs() > f64::EPSILON {
                let _ = window.set_zoom(zoom);
            }

            if settings.maximized {
                let _ = window.maximize();
            }

            system_monitor::set_paused(false);
            let _ = window.set_focus();
            Some(window)
        }
        Err(e) => {
            tracing::error!("Failed to create main window: {e}");
            None
        }
    }
}
