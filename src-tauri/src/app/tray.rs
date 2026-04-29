//! System tray setup and event handling

use crate::app::window::{create_main_window, show_and_focus_window};
use crate::domain::monitoring::system_monitor::SystemMonitorService;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

use super::IS_QUITTING;

const TRAY_ID: &str = "main-tray";
const DEFAULT_TOOLTIP: &str = "Axelate";

/// Managed tray state used for language-aware labels and background status tooltip updates.
pub struct TrayStatusState {
    show_item: MenuItem<tauri::Wry>,
    quit_item: MenuItem<tauri::Wry>,
    background_active: AtomicBool,
}

impl std::fmt::Debug for TrayStatusState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TrayStatusState")
            .field(
                "background_active",
                &self.background_active.load(Ordering::Relaxed),
            )
            .finish_non_exhaustive()
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

fn apply_tray_tooltip(app: &tauri::AppHandle, tooltip: &str) {
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

fn t_label(en: &'static str, ru: &'static str, zh: &'static str) -> &'static str {
    match preferred_language().as_str() {
        lang if lang.starts_with("ru") => ru,
        lang if lang.starts_with("zh") => zh,
        _ => en,
    }
}

fn generating_status_text() -> &'static str {
    t_label(
        "Generating image...",
        "Генерация изображения...",
        "正在生成图像...",
    )
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
        (Some(p), Some(f), Some(r)) => {
            format!(
                "{}: {} - {} - {}",
                t_label("Image", "Картинка", "图像"),
                p,
                f,
                r
            )
        }
        (Some(p), Some(f), None) => {
            format!("{}: {} - {}", t_label("Image", "Картинка", "图像"), p, f)
        }
        (None, Some(f), Some(r)) => {
            format!("{}: {} - {}", t_label("Image", "Картинка", "图像"), f, r)
        }
        (Some(p), None, None) => format!("{}: {}", t_label("Progress", "Прогресс", "进度"), p),
        _ => generating_status_text().to_string(),
    }
}

/// Refreshes tray menu labels and tooltip after the preferred UI language changes.
pub fn refresh_tray_language(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<TrayStatusState>() {
        let _ = state.show_item.set_text(t_label("Open", "Открыть", "打开"));
        let _ = state.quit_item.set_text(t_label("Quit", "Выход", "退出"));

        let tooltip = if state.is_active() {
            generating_status_text()
        } else {
            DEFAULT_TOOLTIP
        };

        apply_tray_tooltip(app, tooltip);
    }
}

/// Marks background generation as active and updates tray tooltip immediately.
pub fn set_background_generation_active(app: &tauri::AppHandle, _status: &str) {
    if let Some(state) = app.try_state::<TrayStatusState>() {
        state.set_active(true);
    }
    let status = generating_status_text();
    apply_tray_tooltip(app, &format!("{DEFAULT_TOOLTIP} - {status}"));
}

/// Updates tray tooltip while a background generation is active.
pub fn update_background_generation_progress(app: &tauri::AppHandle, progress: &str) {
    if let Some(state) = app.try_state::<TrayStatusState>() {
        if !state.is_active() {
            return;
        }
    } else {
        return;
    }

    let status = format_progress_summary(progress);
    apply_tray_tooltip(app, &format!("{DEFAULT_TOOLTIP} - {status}"));
}

/// Clears background generation status and restores the default tray tooltip.
pub fn clear_background_generation(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<TrayStatusState>() {
        state.set_active(false);
    }
    apply_tray_tooltip(app, DEFAULT_TOOLTIP);
}

/// Setup system tray icon with menu.
pub fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(
        app,
        "show",
        t_label("Open", "Открыть", "打开"),
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(
        app,
        "quit",
        t_label("Quit", "Выход", "退出"),
        true,
        None::<&str>,
    )?;

    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let icon = app
        .default_window_icon()
        .ok_or("System must have a default window icon configured in tauri.conf.json")?
        .clone();

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(DEFAULT_TOOLTIP)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app: &tauri::AppHandle, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    show_and_focus_window(&window);
                    if let Some(monitor) = app.try_state::<std::sync::Arc<SystemMonitorService>>() {
                        monitor.set_paused(false);
                    }
                } else {
                    create_main_window(app);
                }
            }
            "quit" => {
                IS_QUITTING.store(true, Ordering::Relaxed);
                if let Some(monitor) = app.try_state::<std::sync::Arc<SystemMonitorService>>() {
                    std::sync::Arc::clone(&*monitor).stop_monitoring();
                }

                let sessions_arc = app
                    .try_state::<std::sync::Arc<crate::domain::ai::ChatSessionManager>>()
                    .map(|s| std::sync::Arc::clone(&*s));
                if let Some(sessions) = sessions_arc {
                    if let Err(error) = sessions.save_to_disk() {
                        tracing::error!("Failed to save chat history during shutdown: {error:?}");
                    } else {
                        tracing::info!("AI history flushed successfully during shutdown.");
                    }
                }

                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    show_and_focus_window(&window);
                    if let Some(monitor) = app.try_state::<std::sync::Arc<SystemMonitorService>>() {
                        monitor.set_paused(false);
                    }
                } else {
                    create_main_window(app);
                }
            }
        })
        .build(app)?;

    app.manage(TrayStatusState {
        show_item,
        quit_item,
        background_active: AtomicBool::new(false),
    });

    Ok(())
}
