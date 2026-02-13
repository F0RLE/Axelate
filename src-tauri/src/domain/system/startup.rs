/// Trait for system runtime checks (e.g., WebView2).
pub trait SystemRuntime: std::fmt::Debug + Send + Sync {
    /// Checks if the necessary system components are installed.
    fn is_webview2_installed(&self) -> bool;
}

/// Trait for network connectivity checks.
pub trait Connectivity: std::fmt::Debug + Send + Sync {
    /// Checks if the device has internet access.
    fn has_internet(&self) -> bool;
}

/// Trait for user alerts during startup.
pub trait StartupAlert: std::fmt::Debug + Send + Sync {
    /// Displays an error to the user and returns true if they want to retry.
    fn show_environment_error(&self) -> bool;
}

/// Orchestrates environment validation during application startup.
#[derive(Debug)]
pub struct EnvironmentValidator {
    runtime: Box<dyn SystemRuntime>,
    network: Box<dyn Connectivity>,
    alert: Box<dyn StartupAlert>,
}

impl EnvironmentValidator {
    /// Creates a new `EnvironmentValidator`.
    pub fn new(
        runtime: Box<dyn SystemRuntime>,
        network: Box<dyn Connectivity>,
        alert: Box<dyn StartupAlert>,
    ) -> Self {
        Self {
            runtime,
            network,
            alert,
        }
    }

    /// Validates the environment, looping if necessary until successful or aborted.
    pub fn validate(&self) {
        loop {
            if self.runtime.is_webview2_installed() {
                return;
            }

            // If WebView2 is missing, we need internet for the bootstrapper to work.
            if self.network.has_internet() {
                return;
            }

            // Missing WebView2 AND No Internet.
            if !self.alert.show_environment_error() {
                // User clicked Cancel or close.
                std::process::exit(1);
            }
            // User clicked Retry, loop again.
        }
    }
}
