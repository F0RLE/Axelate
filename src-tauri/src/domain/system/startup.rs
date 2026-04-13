/// Action selected in the startup requirement dialog.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StartupDialogAction {
    /// Open the installation page or guide.
    OpenInstallGuide,
    /// Abort startup without opening anything.
    Cancel,
}

/// Platform dependency that can block startup before the UI is created.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StartupRequirement {
    /// Microsoft WebView2 Runtime is missing on Windows.
    WindowsWebView2,
    /// WebKitGTK runtime is missing on Linux.
    LinuxWebKitGtk,
}

impl StartupRequirement {
    /// Returns the official installation or guidance URL for this requirement.
    #[must_use]
    pub const fn install_url(self) -> &'static str {
        match self {
            Self::WindowsWebView2 => {
                "https://developer.microsoft.com/en-us/microsoft-edge/webview2/"
            }
            Self::LinuxWebKitGtk => "https://v2.tauri.app/start/prerequisites/",
        }
    }
}

/// Localized content shown in the native startup dialog.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StartupPrompt {
    /// Dialog title.
    pub title: String,
    /// Main dialog body.
    pub message: String,
    /// Confirm button label.
    pub confirm_label: String,
    /// Cancel button label.
    pub cancel_label: String,
}

impl StartupPrompt {
    /// Creates a localized prompt for the blocking startup requirement.
    #[must_use]
    pub fn for_requirement(requirement: StartupRequirement, language: &str) -> Self {
        match normalize_supported_language(language) {
            "ru" => localized_prompt_ru(requirement),
            "zh" => localized_prompt_zh(requirement),
            _ => localized_prompt_en(requirement),
        }
    }
}

/// OS-specific startup integration.
pub trait StartupEnvironment: std::fmt::Debug + Send + Sync {
    /// Detects whether startup is blocked by a missing runtime dependency.
    fn blocking_requirement(&self) -> Option<StartupRequirement>;
    /// Shows a native prompt to the user and returns the selected action.
    fn show_requirement_prompt(&self, prompt: &StartupPrompt) -> StartupDialogAction;
    /// Opens the installation or guidance URL in the system browser.
    fn open_install_guide(&self, url: &str);
}

/// Validates system requirements before the first window is created.
#[derive(Debug)]
pub struct EnvironmentValidator {
    environment: Box<dyn StartupEnvironment>,
    language: String,
}

impl EnvironmentValidator {
    /// Creates a new startup validator.
    pub fn new(environment: Box<dyn StartupEnvironment>, language: String) -> Self {
        Self {
            environment,
            language,
        }
    }

    /// Runs startup validation and exits the process on blocking requirements.
    pub fn validate(&self) {
        let Some(requirement) = self.environment.blocking_requirement() else {
            return;
        };

        let prompt = StartupPrompt::for_requirement(requirement, &self.language);
        if self.environment.show_requirement_prompt(&prompt)
            == StartupDialogAction::OpenInstallGuide
        {
            self.environment
                .open_install_guide(requirement.install_url());
        }

        std::process::exit(1);
    }
}

fn normalize_supported_language(language: &str) -> &str {
    let lower = language.trim().to_ascii_lowercase();
    if lower.starts_with("ru") {
        "ru"
    } else if lower.starts_with("zh") {
        "zh"
    } else {
        "en"
    }
}

fn localized_prompt_en(requirement: StartupRequirement) -> StartupPrompt {
    let message = match requirement {
        StartupRequirement::WindowsWebView2 => {
            "Axelate requires Microsoft Edge WebView2 Runtime on Windows.\n\nClick \"Install\" to open the official WebView2 download page, then run the installer and launch Axelate again."
        }
        StartupRequirement::LinuxWebKitGtk => {
            "Axelate requires WebKitGTK 4.1 runtime on Linux.\n\nClick \"Install\" to open the official prerequisite guide, install the required WebKitGTK package for your distribution, then launch Axelate again."
        }
    };

    StartupPrompt {
        title: "Axelate Setup Required".to_string(),
        message: message.to_string(),
        confirm_label: "Install".to_string(),
        cancel_label: "Cancel".to_string(),
    }
}

fn localized_prompt_ru(requirement: StartupRequirement) -> StartupPrompt {
    let message = match requirement {
        StartupRequirement::WindowsWebView2 => {
            "Axelate нужен Microsoft Edge WebView2 Runtime в Windows.\n\nНажмите «Установить», чтобы открыть официальную страницу WebView2, затем установите компонент и запустите Axelate снова."
        }
        StartupRequirement::LinuxWebKitGtk => {
            "Axelate нужен runtime WebKitGTK 4.1 в Linux.\n\nНажмите «Установить», чтобы открыть официальную инструкцию, поставьте нужный пакет WebKitGTK для вашего дистрибутива и затем снова запустите Axelate."
        }
    };

    StartupPrompt {
        title: "Axelate: требуется компонент".to_string(),
        message: message.to_string(),
        confirm_label: "Установить".to_string(),
        cancel_label: "Отмена".to_string(),
    }
}

fn localized_prompt_zh(requirement: StartupRequirement) -> StartupPrompt {
    let message = match requirement {
        StartupRequirement::WindowsWebView2 => {
            "Axelate 在 Windows 上需要 Microsoft Edge WebView2 Runtime。\n\n点击“安装”打开官方 WebView2 下载页面，安装完成后重新启动 Axelate。"
        }
        StartupRequirement::LinuxWebKitGtk => {
            "Axelate 在 Linux 上需要 WebKitGTK 4.1 运行时。\n\n点击“安装”打开官方依赖说明，为你的发行版安装所需的 WebKitGTK 软件包，然后重新启动 Axelate。"
        }
    };

    StartupPrompt {
        title: "Axelate 需要安装组件".to_string(),
        message: message.to_string(),
        confirm_label: "安装".to_string(),
        cancel_label: "取消".to_string(),
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Debug)]
    struct StubEnvironment {
        requirement: Option<StartupRequirement>,
        action: StartupDialogAction,
        opened_urls: Arc<Mutex<Vec<String>>>,
    }

    impl StartupEnvironment for StubEnvironment {
        fn blocking_requirement(&self) -> Option<StartupRequirement> {
            self.requirement
        }

        fn show_requirement_prompt(&self, _prompt: &StartupPrompt) -> StartupDialogAction {
            self.action
        }

        fn open_install_guide(&self, url: &str) {
            self.opened_urls
                .lock()
                .expect("poisoned")
                .push(url.to_string());
        }
    }

    #[test]
    fn startup_prompt_is_localized_for_supported_languages() {
        let ru = StartupPrompt::for_requirement(StartupRequirement::WindowsWebView2, "ru-RU");
        let zh = StartupPrompt::for_requirement(StartupRequirement::LinuxWebKitGtk, "zh_CN");
        let en = StartupPrompt::for_requirement(StartupRequirement::WindowsWebView2, "de-DE");

        assert_eq!(ru.confirm_label, "Установить");
        assert_eq!(zh.cancel_label, "取消");
        assert_eq!(en.confirm_label, "Install");
    }

    #[test]
    fn validator_does_nothing_when_requirement_is_satisfied() {
        let opened_urls = Arc::new(Mutex::new(Vec::new()));
        let validator = EnvironmentValidator::new(
            Box::new(StubEnvironment {
                requirement: None,
                action: StartupDialogAction::Cancel,
                opened_urls: Arc::clone(&opened_urls),
            }),
            "en".to_string(),
        );

        validator.validate();

        assert!(opened_urls.lock().expect("poisoned").is_empty());
    }

    #[test]
    fn linux_requirement_points_to_official_guide() {
        assert_eq!(
            StartupRequirement::LinuxWebKitGtk.install_url(),
            "https://v2.tauri.app/start/prerequisites/"
        );
    }
}
