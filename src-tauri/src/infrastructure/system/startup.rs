use crate::domain::system::startup::{
    StartupDialogAction, StartupEnvironment, StartupPrompt, StartupRequirement,
};
use std::process::Command;
#[cfg(target_os = "windows")]
use std::{fmt::Write as _, ptr::null_mut};

#[cfg(target_os = "linux")]
use std::path::Path;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::ERROR_SUCCESS;
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Registry::{
    HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, RegCloseKey, RegOpenKeyExW, RegQueryValueExW,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{IDOK, MB_ICONERROR, MB_OKCANCEL, MessageBoxW};

/// Cross-platform startup dependency checks and native prompts.
#[derive(Debug, Default)]
pub struct PlatformStartupInfrastructure;

impl StartupEnvironment for PlatformStartupInfrastructure {
    fn blocking_requirement(&self) -> Option<StartupRequirement> {
        detect_blocking_requirement()
    }

    fn show_requirement_prompt(&self, prompt: &StartupPrompt) -> StartupDialogAction {
        show_native_prompt(prompt)
    }

    fn open_install_guide(&self, url: &str) {
        open_external_url(url);
    }
}

fn detect_blocking_requirement() -> Option<StartupRequirement> {
    #[cfg(target_os = "windows")]
    {
        if !is_webview2_installed() {
            return Some(StartupRequirement::WindowsWebView2);
        }
    }

    #[cfg(target_os = "linux")]
    {
        if !has_linux_webkit_runtime() {
            return Some(StartupRequirement::LinuxWebKitGtk);
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn encode_wide(input: &str) -> Vec<u16> {
    input.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn is_webview2_installed() -> bool {
    let machine_subkey = encode_wide(
        "SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    );
    let user_subkey = encode_wide(
        "Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    );
    let value_name = encode_wide("pv");

    check_registry_value(HKEY_LOCAL_MACHINE as _, &machine_subkey, &value_name)
        || check_registry_value(HKEY_CURRENT_USER as _, &user_subkey, &value_name)
}

#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
fn check_registry_value(hkey: isize, subkey: &[u16], value_name: &[u16]) -> bool {
    let mut opened_key: isize = 0;
    unsafe {
        if RegOpenKeyExW(
            hkey as _,
            subkey.as_ptr(),
            0,
            KEY_READ,
            std::ptr::addr_of_mut!(opened_key).cast(),
        ) as u32
            != ERROR_SUCCESS
        {
            return false;
        }

        let mut size = 0;
        let status = RegQueryValueExW(
            opened_key as _,
            value_name.as_ptr(),
            null_mut(),
            null_mut(),
            null_mut(),
            &raw mut size,
        ) as u32;
        RegCloseKey(opened_key as _);
        status == ERROR_SUCCESS && size > 0
    }
}

#[cfg(target_os = "linux")]
fn has_linux_webkit_runtime() -> bool {
    if command_output_contains(
        "sh",
        &[
            "-c",
            "ldconfig -p 2>/dev/null | grep -F 'libwebkit2gtk-4.1.so.0' >/dev/null",
        ],
    ) {
        return true;
    }

    let known_paths = [
        "/usr/lib/libwebkit2gtk-4.1.so.0",
        "/usr/lib64/libwebkit2gtk-4.1.so.0",
        "/usr/lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0",
        "/usr/lib/aarch64-linux-gnu/libwebkit2gtk-4.1.so.0",
        "/lib/libwebkit2gtk-4.1.so.0",
        "/lib64/libwebkit2gtk-4.1.so.0",
        "/app/lib/libwebkit2gtk-4.1.so.0",
    ];

    known_paths.iter().any(|path| Path::new(path).exists())
}

#[cfg(target_os = "windows")]
fn show_native_prompt(prompt: &StartupPrompt) -> StartupDialogAction {
    #[allow(unsafe_code)]
    unsafe {
        let title = encode_wide(&prompt.title);
        let mut message = prompt.message.clone();
        message.push_str("\n\n");
        let _ = write!(
            message,
            "{} / {}",
            prompt.confirm_label, prompt.cancel_label
        );
        let body = encode_wide(&message);
        let result = MessageBoxW(
            0 as _,
            body.as_ptr(),
            title.as_ptr(),
            MB_OKCANCEL | MB_ICONERROR,
        );
        if result == IDOK {
            StartupDialogAction::OpenInstallGuide
        } else {
            StartupDialogAction::Cancel
        }
    }
}

#[cfg(target_os = "macos")]
fn show_native_prompt(prompt: &StartupPrompt) -> StartupDialogAction {
    let script = format!(
        "display dialog \"{}\" with title \"{}\" buttons {{\"{}\", \"{}\"}} default button \"{}\" with icon caution",
        escape_applescript(&prompt.message),
        escape_applescript(&prompt.title),
        escape_applescript(&prompt.cancel_label),
        escape_applescript(&prompt.confirm_label),
        escape_applescript(&prompt.confirm_label),
    );

    let output = Command::new("osascript").args(["-e", &script]).output();
    if output.is_ok_and(|result| result.status.success()) {
        StartupDialogAction::OpenInstallGuide
    } else {
        StartupDialogAction::Cancel
    }
}

#[cfg(target_os = "linux")]
fn show_native_prompt(prompt: &StartupPrompt) -> StartupDialogAction {
    if command_succeeds(
        "zenity",
        &[
            "--question",
            "--title",
            &prompt.title,
            "--text",
            &prompt.message,
            "--ok-label",
            &prompt.confirm_label,
            "--cancel-label",
            &prompt.cancel_label,
        ],
    ) {
        return StartupDialogAction::OpenInstallGuide;
    }

    if command_succeeds(
        "kdialog",
        &[
            "--warningyesno",
            &prompt.message,
            "--title",
            &prompt.title,
            "--yes-label",
            &prompt.confirm_label,
            "--no-label",
            &prompt.cancel_label,
        ],
    ) {
        return StartupDialogAction::OpenInstallGuide;
    }

    eprintln!("{}\n\n{}", prompt.title, prompt.message);
    StartupDialogAction::Cancel
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn show_native_prompt(prompt: &StartupPrompt) -> StartupDialogAction {
    eprintln!("{}\n\n{}", prompt.title, prompt.message);
    StartupDialogAction::Cancel
}

#[cfg(target_os = "macos")]
fn escape_applescript(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn open_external_url(url: &str) {
    #[cfg(target_os = "windows")]
    {
        if let Err(error) = Command::new("cmd").args(["/C", "start", "", url]).spawn() {
            tracing::warn!("Failed to open startup install guide URL '{url}': {error}");
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Err(error) = Command::new("open").arg(url).spawn() {
            tracing::warn!("Failed to open startup install guide URL '{url}': {error}");
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Err(error) = Command::new("xdg-open").arg(url).spawn() {
            tracing::warn!("Failed to open startup install guide URL '{url}': {error}");
        }
    }
}

#[cfg(target_os = "linux")]
fn command_succeeds(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(target_os = "linux")]
fn command_output_contains(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .status()
        .is_ok_and(|status| status.success())
}
