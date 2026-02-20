//! System tray setup and event handling

use crate::app::window::{create_main_window, show_and_focus_window};
use crate::domain::monitoring::system_monitor;
use std::sync::atomic::Ordering;
use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

use super::IS_QUITTING;

/// Setup system tray icon with menu
pub fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Create menu items
    let show_item = MenuItem::with_id(app, "show", "Open", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    // Create menu
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    // Build tray icon
    let icon = app
        .default_window_icon()
        .ok_or("System must have a default window icon configured in tauri.conf.json")?
        .clone();

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Axelate")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        show_and_focus_window(&window);
                        system_monitor::set_paused(false);
                    } else {
                        // Does not exist: Create it.
                        // It will show ITSELF when the frontend is ready (to avoid white flash).
                        create_main_window(app);
                    }
                }
                "quit" => {
                    // Graceful shutdown
                    IS_QUITTING.store(true, Ordering::Relaxed);
                    system_monitor::stop_monitoring();

                    // Force immediate save of all chat history before exit in a background thread
                    // to prevent hanging the tray menu UI while writing to disk.
                    std::thread::spawn(|| {
                        if let Err(e) =
                            crate::domain::ai::session::ChatSessionManager::save_to_disk()
                        {
                            log::error!("Failed to save chat history during shutdown: {e:?}");
                        } else {
                            log::info!("AI history flushed successfully during shutdown.");
                        }
                    });

                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    show_and_focus_window(&window);
                    system_monitor::set_paused(false);
                } else {
                    create_main_window(app);
                }
            }
        })
        .build(app)?;

    Ok(())
}
