//! System tray setup and event handling

use crate::app::window::{create_main_window, show_and_focus_window};
use crate::domain::monitoring::system_monitor;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

use super::IS_QUITTING;

const TRAY_ID: &str = "main-tray";
const DEFAULT_TOOLTIP: &str = "Axelate";

/// Managed tray status state used for background generation updates.
pub struct TrayStatusState {
    status_item: MenuItem<tauri::Wry>,
    background_active: AtomicBool,
}

impl std::fmt::Debug for TrayStatusState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TrayStatusState")
            .field("background_active", &self.background_active.load(Ordering::Relaxed))
            .finish()
    }
}

impl TrayStatusState {
    fn set_active(&self, active: bool) {
        self.background_active.store(active, Ordering::Relaxed);
    }

    fn is_active(&self) -> bool {
        self.background_active.load(Ordering::Relaxed)
    }
}

fn apply_tray_status(app: &tauri::AppHandle, status: &str, tooltip: &str) {
    if let Some(state) = app.try_state::<TrayStatusState>() {
        let _ = state.status_item.set_text(status);
    }

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

fn preferred_language() -> String {
    crate::infrastructure::config::ui_state::get_ui_state_sync()
        .preferred_language
        .unwrap_or_else(|| "en".to_string())
        .to_lowercase()
}

fn is_russian() -> bool {
    preferred_language().starts_with("ru")
}

fn t_en_ru(en: &'static str, ru: &'static str) -> &'static str {
    if is_russian() { ru } else { en }
}

fn idle_status_text() -> &'static str {
    t_en_ru("Background: idle", "Фон: ожидание")
}

fn generating_status_text() -> &'static str {
    t_en_ru("Generating image...", "Генерация изображения...")
}

fn format_progress_summary(progress: &str) -> String {
    let trimmed = progress.trim();
    if trimmed.is_empty() {
        return generating_status_text().to_string();
    }

    let parts = trimmed.split_whitespace().collect::<Vec<_>>();
    let percent = parts.iter().find(|part| part.contains('%')).copied();
    let fraction = parts.iter().find(|part| part.contains('/')).copied();
    let rate = parts
        .iter()
        .find(|part| part.contains("it/s") || part.contains("s/it"))
        .copied();

    match (percent, fraction, rate) {
        (Some(p), Some(f), Some(r)) => format!("{}: {} - {} - {}", t_en_ru("Image", "Картинка"), p, f, r),
        (Some(p), Some(f), None) => format!("{}: {} - {}", t_en_ru("Image", "Картинка"), p, f),
        (None, Some(f), Some(r)) => format!("{}: {} - {}", t_en_ru("Image", "Картинка"), f, r),
        (Some(p), None, None) => format!("{}: {}", t_en_ru("Progress", "Прогресс"), p),
        _ => generating_status_text().to_string(),
    }
}

/// Marks background generation as active and updates tray text immediately.
pub fn set_background_generation_active(app: &tauri::AppHandle, _status: &str) {
    if let Some(state) = app.try_state::<TrayStatusState>() {
        state.set_active(true);
    }
    let status = generating_status_text();
    apply_tray_status(app, status, &format!("{DEFAULT_TOOLTIP} - {status}"));
}

/// Updates the tray progress line while a background generation is active.
pub fn update_background_generation_progress(app: &tauri::AppHandle, progress: &str) {
    if let Some(state) = app.try_state::<TrayStatusState>() {
        if !state.is_active() {
            return;
        }
    } else {
        return;
    }

    let status = format_progress_summary(progress);
    apply_tray_status(app, &status, &format!("{DEFAULT_TOOLTIP} - {status}"));
}

/// Clears background generation status and restores the default tray text.
pub fn clear_background_generation(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<TrayStatusState>() {
        state.set_active(false);
    }
    apply_tray_status(app, idle_status_text(), DEFAULT_TOOLTIP);
}

/// Setup system tray icon with menu
pub fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Create menu items
    let show_item = MenuItem::with_id(app, "show", t_en_ru("Open", "Открыть"), true, None::<&str>)?;
    let status_item = MenuItem::with_id(
        app,
        "background-status",
        idle_status_text(),
        false,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, "quit", t_en_ru("Quit", "Выход"), true, None::<&str>)?;

    // Create menu
    let menu = Menu::with_items(app, &[&show_item, &status_item, &quit_item])?;

    // Build tray icon
    let icon = app
        .default_window_icon()
        .ok_or("System must have a default window icon configured in tauri.conf.json")?
        .clone();

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(DEFAULT_TOOLTIP)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app: &tauri::AppHandle, event| {
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

                    // Force immediate save of all chat history before exit.
                    let sessions_arc = app
                        .try_state::<std::sync::Arc<crate::domain::ai::ChatSessionManager>>()
                        .map(|s| std::sync::Arc::clone(&*s));
                    if let Some(sessions) = sessions_arc {
                        std::thread::spawn(move || {
                            if let Err(e) = sessions.save_to_disk() {
                                tracing::error!(
                                    "Failed to save chat history during shutdown: {e:?}"
                                );
                            } else {
                                tracing::info!("AI history flushed successfully during shutdown.");
                            }
                        });
                    }

                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event| {
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

    app.manage(TrayStatusState {
        status_item,
        background_active: AtomicBool::new(false),
    });

    Ok(())
}
