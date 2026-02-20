//! App-level window management
//!
//! Handles WebView2 cache isolation, global shortcuts, and window
//! creation / restoration from saved state.

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
            log::error!("Failed to create custom data directory: {e}");
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
                        log::info!("Ctrl+Space pressed. Toggling existing window.");
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
                        log::debug!("Ctrl+Space pressed but WebView is dead. Ignoring.");
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
            // 4. Apply zoom and maximized state
            let ui_settings = infra_ui_state::get_ui_state_sync();
            let mut zoom = ui_settings.zoom_level;

            // Try to detect monitor resolution and apply specific zoom early
            if let Ok(Some(monitor)) = window.primary_monitor() {
                let scale_factor = monitor.scale_factor();
                let size = monitor.size().to_logical::<u32>(scale_factor);
                let res_key = format!("{}x{}", size.width, size.height);
                if let Some(&res_zoom) = ui_settings.resolution_zoom.get(&res_key) {
                    zoom = res_zoom;
                    log::debug!("Applying saved resolution zoom: {zoom} for {res_key}");
                } else {
                    zoom = infra_window_settings::calculate_adaptive_zoom(size.height);
                    log::debug!("Applying default resolution zoom: {zoom} for {res_key}");
                }
            }

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
            log::error!("Failed to create main window: {e}");
            None
        }
    }
}
