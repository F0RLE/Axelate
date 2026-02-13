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

use crate::domain::system::startup::{Connectivity, StartupAlert, SystemRuntime};
use crate::utils::windows::detect_system_language;

/// Windows-specific implementation of startup checks and notifications.
#[derive(Debug)]
pub struct WindowsStartupInfrastructure;

impl WindowsStartupInfrastructure {
    fn encode_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    #[allow(unsafe_code)]
    fn check_reg_key(&self, hkey: isize, subkey: &[u16], value_name: &[u16]) -> bool {
        let mut hkey_out: isize = 0;
        #[allow(clippy::borrow_as_ptr, clippy::ptr_as_ptr)]
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
}

impl SystemRuntime for WindowsStartupInfrastructure {
    fn is_webview2_installed(&self) -> bool {
        let subkey = Self::encode_wide(
            "SOFTWARE\\WOW6432Node\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        );
        let subkey_user = Self::encode_wide(
            "Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        );
        let value_name = Self::encode_wide("pv");

        if self.check_reg_key(HKEY_LOCAL_MACHINE as _, &subkey, &value_name) {
            return true;
        }
        if self.check_reg_key(HKEY_CURRENT_USER as _, &subkey_user, &value_name) {
            return true;
        }
        false
    }
}

impl Connectivity for WindowsStartupInfrastructure {
    fn has_internet(&self) -> bool {
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
}

impl StartupAlert for WindowsStartupInfrastructure {
    #[allow(unsafe_code)]
    fn show_environment_error(&self) -> bool {
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

        let title_w = Self::encode_wide(title);
        let message_w = Self::encode_wide(message);

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
}
