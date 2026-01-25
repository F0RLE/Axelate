// use crate::services::system_monitor;
// use tauri::Manager;

#[tauri::command]
pub fn minimize_window(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
pub fn maximize_window(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
pub fn close_window(window: tauri::Window) {
    // Graceful close: just close the window (destroying WebView).
    // The App remains running in the tray.
    let _ = window.close();
}

#[tauri::command]
pub fn show_window(window: tauri::Window) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
pub fn hide_window(window: tauri::Window) {
    let _ = window.hide();
}
