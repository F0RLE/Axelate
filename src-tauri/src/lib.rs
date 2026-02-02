pub mod commands;
pub mod errors;
pub mod models;
pub mod services;
pub mod utils;

#[cfg(test)]
mod tests;

use commands::*;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};

static IS_QUITTING: AtomicBool = AtomicBool::new(false);

/// Orchestrates the creation or restoration of the primary application window.
///
/// Retrieves serialized window state to preserve user context across sessions.
fn create_main_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    // 1. Check if window already exists
    if let Some(window) = app.get_webview_window("main") {
        return Some(window);
    }

    // 2. Load saved settings for "cold start" restoration
    let settings = crate::services::window_settings::load_window_settings();

    // 3. Create the window
    let mut builder =
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            .title("Axelate (Beta)")
            .resizable(true)
            .fullscreen(false)
            .transparent(false)
            .visible(false) // Start invisible to avoid flicker while moving/resizing
            .decorations(false) // Custom titlebar
            .inner_size(settings.width as f64, settings.height as f64);

    // Restore position if valid
    if let (Some(x), Some(y)) = (settings.x, settings.y) {
        builder = builder.position(x as f64, y as f64);
    }

    // Attempt to build
    match builder.build() {
        Ok(window) => {
            // 4. Apply zoom and maximized state
            let ui_settings = crate::services::ui_state::get_ui_state().unwrap_or_default();
            let mut zoom = ui_settings.zoom_level;

            // Try to detect monitor resolution and apply specific zoom early
            if let Ok(Some(monitor)) = window.primary_monitor() {
                let size = monitor.size();
                let res_key = format!("{}x{}", size.width, size.height);
                if let Some(&res_zoom) = ui_settings.resolution_zoom.get(&res_key) {
                    zoom = res_zoom;
                    log::debug!("Applying saved resolution zoom: {} for {}", zoom, res_key);
                } else {
                    zoom = crate::services::window_settings::calculate_adaptive_zoom(size.height);
                    log::debug!("Applying default resolution zoom: {} for {}", zoom, res_key);
                }
            }

            if (zoom - 1.0).abs() > f64::EPSILON {
                let _ = window.set_zoom(zoom);
            }

            if settings.maximized {
                let _ = window.maximize();
            }

            // Defer window visibility until frontend initialization signals readiness
            // to mitigate visual artifacts (white flash) during WebView rehydration.
            services::system_monitor::set_paused(false);

            // let _ = window.show(); // Removed to prevent flicker
            let _ = window.set_focus();
            Some(window)
        }
        Err(e) => {
            log::error!("Failed to create main window: {}", e);
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 1. Mandatory Environment Validation (WebView2 & Internet)
    crate::utils::setup::validate_environment();

    // Initialize logging
    crate::services::logs::init_global_logger().ok();

    // Set WebView2 user data folder to AppData\Roaming\AxelateData\Cache
    if let Ok(app_data) = std::env::var("APPDATA") {
        let mut path = std::path::PathBuf::from(app_data);
        path.push("AxelateData");
        path.push("Cache");
        path.push("com.axelate");
        if let Err(e) = std::fs::create_dir_all(&path) {
            log::error!("Failed to create custom data directory: {}", e);
        } else {
            unsafe {
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &path);
            }
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Check if window exists (might be destroyed for optimization)
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();

                #[cfg(target_os = "windows")]
                {
                    // Force window to top to steal focus from the new instance
                    let _ = window.set_always_on_top(true);
                    std::thread::sleep(std::time::Duration::from_millis(100)); // Minimal delay to ensure OS registers layer change
                    let _ = window.set_always_on_top(false);
                    let _ = window.set_focus();
                }

                crate::services::system_monitor::set_paused(false);
            } else {
                // If window doesn't exist (frontend destroyed), create it
                // This matches the behavior of clicking "Open" in the tray menu
                create_main_window(app);
            }
            log::info!("Single instance lock: Second instance launch attempt detected.");
        }))
        .invoke_handler(tauri::generate_handler![
            health::get_health,
            config::get_config,
            settings::get_settings,
            settings::save_settings,
            settings::save_setting,
            settings::get_system_language,
            logs::get_logs,
            logs::clear_logs,
            logs::add_log,
            logs::log_batch,
            downloader::download_module,
            downloader::check_module_installed,
            downloader::get_module_path,
            downloader::delete_module,
            downloader::list_module_files,
            downloader::set_download_settings,
            system::get_system_stats,
            system::get_gpu_info,
            system::set_monitoring_paused,
            modules::get_modules,
            modules::control_module,
            modules::get_module_status,
            modules::launch_module,
            window::minimize_window,
            window::maximize_window,
            window::close_window,
            window::show_window,
            window::hide_window,
            translations::get_translations,
            license::get_license_status,
            license::activate_license,
            license::deactivate_license,
            license::check_feature,
            theme::get_theme_colors,
            window_settings::get_window_settings,
            window_settings::save_window_size,
            window_settings::save_window_position,
            window_settings::save_maximized_state,
            window_settings::save_zoom_level,
            window_settings::set_webview_zoom,
            window_settings::get_webview_zoom,
            window_settings::get_resolution_zoom,
            window_settings::get_window_config,
            window_settings::get_window_policy,
            ui_state::get_ui_state,
            ui_state::save_ui_state,
            bootstrap::get_app_bootstrap_data,
            secure::save_secure_key,
            secure::get_secure_key,
            ai::send_chat_message,
            ai::validate_api_key,
            ai::clear_chat_history,
            ai::get_chat_history,
            ai::count_tokens,
            services::custom_model_service::get_custom_models,
            services::custom_model_service::add_custom_model,
            services::custom_model_service::remove_custom_model,
            services::file_service::process_file_content,
        ])
        .setup(|app| {
            crate::utils::paths::init_filesystem().ok();
            crate::utils::process::init_process_group();

            // Start system monitoring with events
            // Polling reduced to 2000ms (2s) to save CPU
            services::system_monitor::start_monitoring(app.handle().clone(), 2000);

            // Register Global Shortcut (Modified to recreate window)
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcut("Ctrl+Space")?
                        .with_handler(move |app, shortcut, event| {
                            if event.state == ShortcutState::Pressed
                                && shortcut.matches(Modifiers::CONTROL, Code::Space)
                            {
                                // User Request: Shortcut only works if WebView is alive.
                                // Do NOT create window if missing.
                                if let Some(window) = app.get_webview_window("main") {
                                    log::info!("Ctrl+Space pressed. Toggling existing window.");
                                    // If visible and focused -> minimize
                                    let is_visible = window.is_visible().unwrap_or(false);
                                    let is_focused = window.is_focused().unwrap_or(false);

                                    if is_visible && is_focused {
                                        let _ = window.minimize();
                                        services::system_monitor::set_paused(true);
                                        crate::utils::memory::trim_memory();
                                    } else {
                                        let _ = window.unminimize();
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                        services::system_monitor::set_paused(false);
                                    }
                                } else {
                                    log::debug!(
                                        "Ctrl+Space pressed but WebView is dead. Ignoring."
                                    );
                                }
                            }
                        })
                        .build(),
                )?;
            }

            // Start HTTP Server
            services::server::start_server(app.handle().clone());

            setup_system_tray(app)?;
            log::info!("✅ Setup complete");
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                services::system_monitor::set_paused(true);
                crate::utils::memory::trim_memory();
                // Allow window to close (Destroy WebView)
                // But do NOT exit the app.
                #[cfg(not(target_os = "macos"))]
                {
                    // Window closes naturally.
                    // To prevent app exit, we rely on .run() behavior below.
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                // Prevent exit when all windows are closed, UNLESS we are explicitly quitting
                log::info!(
                    "Received RunEvent::ExitRequested. IS_QUITTING: {}",
                    IS_QUITTING.load(Ordering::Relaxed)
                );
                if !IS_QUITTING.load(Ordering::Relaxed) {
                    crate::utils::memory::trim_memory();
                    api.prevent_exit();
                } else {
                    log::info!("App Exiting...");
                }
            }
        });
}

/// Setup system tray icon with menu
fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Create menu items
    let show_item = MenuItem::with_id(app, "show", "Открыть", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;

    // Create menu
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    // Build tray icon
    let icon = app
        .default_window_icon()
        .expect("system must have a default window icon configured in tauri.conf.json")
        .clone();

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Axelate")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "show" => {
                    // Check if window exists first to determine "Show" strategy
                    if let Some(window) = app.get_webview_window("main") {
                        // Exists: Safe to show immediately
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                        services::system_monitor::set_paused(false);
                    } else {
                        // Does not exist: Create it.
                        // It will show ITSELF when the frontend is ready (to avoid white flash).
                        create_main_window(app);
                        // create_main_window already handles monitoring resume
                    }
                }
                "quit" => {
                    // Graceful shutdown
                    IS_QUITTING.store(true, Ordering::Relaxed);
                    services::system_monitor::stop_monitoring();
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                    services::system_monitor::set_paused(false);
                } else {
                    create_main_window(app);
                }
            }
        })
        .build(app)?;

    Ok(())
}
