#![allow(unsafe_code)]
use std::net::{TcpStream, ToSocketAddrs};
use std::ptr::null_mut;
use std::time::Duration;
use windows_sys::Win32::Foundation::ERROR_SUCCESS;
use windows_sys::Win32::System::Registry::{
    HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, RegCloseKey, RegOpenKeyExW, RegQueryValueExW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    IDRETRY, MB_ICONERROR, MB_RETRYCANCEL, MessageBoxW,
};

use crate::utils::windows::detect_system_language;

/// Validates that the necessary runtime environment is available.
///
/// If WebView2 is missing and no internet is available to download it,
/// displays a native Windows dialog and gives the user a chance to retry.
pub fn validate_environment() {
    #[cfg(target_os = "windows")]
    {
        loop {
            if is_webview2_installed() {
                return;
            }

            // If WebView2 is missing, we need internet for the bootstrapper to work.
            if has_internet_connection() {
                // Internet is available; Tauri's Evergreen bootstrapper should handle the installation.
                // We could still notify the user, but typically the bootstrapper shows its own progress.
                return;
            }

            // Missing WebView2 AND No Internet.
            if !show_error_dialog() {
                // User clicked Cancel or close.
                std::process::exit(1);
            }
            // User clicked Retry, loop again.
        }
    }
}

/// Checks if WebView2 Runtime is installed via Registry.
fn is_webview2_installed() -> bool {
    // Correct GUID for WebView2 Evergreen Runtime: {F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}
    let subkey = encode_wide(
        "SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    );
    let subkey_user = encode_wide(
        "Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    );
    let value_name = encode_wide("pv");

    // Check Machine-wide
    // We cast HKEYs to isize for the helper function to avoid type-dependent errors in different windows-sys versions.
    if check_reg_key(HKEY_LOCAL_MACHINE as _, &subkey, &value_name) {
        return true;
    }

    // Check Per-user
    if check_reg_key(HKEY_CURRENT_USER as _, &subkey_user, &value_name) {
        return true;
    }

    false
}

fn check_reg_key(hkey: isize, subkey: &[u16], value_name: &[u16]) -> bool {
    let mut hkey_out: isize = 0;
    #[allow(clippy::borrow_as_ptr, clippy::ptr_as_ptr)] // Necessary for FFI with windows-sys
    unsafe {
        if RegOpenKeyExW(
            hkey as _,
            subkey.as_ptr(),
            0,
            KEY_READ,
            std::ptr::addr_of_mut!(hkey_out).cast(),
        ) as u32
            == ERROR_SUCCESS
        {
            let mut size = 0;
            // First call to get size
            if RegQueryValueExW(
                hkey_out as _,
                value_name.as_ptr(),
                null_mut(),
                null_mut(),
                null_mut(),
                &mut size,
            ) as u32
                == ERROR_SUCCESS
                && size > 0
            {
                RegCloseKey(hkey_out as _);
                return true;
            }
            RegCloseKey(hkey_out as _);
        }
    }
    false
}

/// Attempts to connect to a reliable host to verify internet availability.
fn has_internet_connection() -> bool {
    let targets = ["google.com:80", "microsoft.com:80", "1.1.1.1:53"];
    for target in targets {
        if let Ok(addrs) = target.to_socket_addrs() {
            for addr in addrs {
                if TcpStream::connect_timeout(&addr, Duration::from_secs(2)).is_ok() {
                    return true;
                }
            }
        }
    }
    false
}

/// Displays a native Windows error dialog.
/// Returns true if the user clicked "Retry".
fn show_error_dialog() -> bool {
    let lang = detect_system_language();

    let (title, message) = match lang.as_str() {
        "ru" => (
            "Ошибка окружения - Axelate",
            "Компонент WebView2 не обнаружен в вашей системе, и отсутствует подключение к интернету для его загрузки.\n\nПожалуйста, подключитесь к интернету и нажмите 'Повторить', чтобы лаунчер смог установить необходимые компоненты.",
        ),
        "zh" => (
            "环境错误 - Axelate",
            "您的系统中未发现 WebView2 运行时，且没有可用的互联网连接来下载它。\n\n请连接互联网并点击“重试”，以允许启动器安装必要的组件。",
        ),
        _ => (
            "Environment Error - Axelate",
            "WebView2 Runtime was not found on your system, and no internet connection is available to download it.\n\nPlease connect to the internet and click 'Retry' to allow the launcher to install the required components.",
        ),
    };

    let title_w = encode_wide(title);
    let message_w = encode_wide(message);

    unsafe {
        let result = MessageBoxW(
            0 as _,
            message_w.as_ptr(),
            title_w.as_ptr(),
            MB_RETRYCANCEL | MB_ICONERROR,
        );

        result == IDRETRY
    }
}

fn encode_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
