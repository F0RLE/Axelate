use crate::utils::paths::{MODULE_LOGS_DIR, RUNTIME_DIR};
use std::path::PathBuf;

const MODULE_RUNTIME_DIR_NAME: &str = "Modules";
const RUNTIME_LOG_FILE_NAME: &str = "runtime.log";

/// Returns the module-owned runtime data root.
pub fn runtime_root(module_id: &str) -> PathBuf {
    RUNTIME_DIR.join(MODULE_RUNTIME_DIR_NAME).join(module_id)
}

/// Returns the module-owned log directory.
pub fn log_dir(module_id: &str) -> PathBuf {
    MODULE_LOGS_DIR.join(module_id)
}

/// Returns the module-owned runtime log file path.
pub fn runtime_log_path(module_id: &str) -> PathBuf {
    log_dir(module_id).join(RUNTIME_LOG_FILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::{log_dir, runtime_log_path, runtime_root};
    use std::path::PathBuf;

    #[test]
    fn module_paths_are_scoped_under_module_roots() {
        let module_id = "axelate-telegram-bot";

        assert!(
            runtime_root(module_id)
                .ends_with(PathBuf::from("Runtime").join("Modules").join(module_id))
        );
        assert!(
            log_dir(module_id).ends_with(PathBuf::from("Logs").join("Modules").join(module_id))
        );
        assert!(
            runtime_log_path(module_id).ends_with(
                PathBuf::from("Logs")
                    .join("Modules")
                    .join(module_id)
                    .join("runtime.log"),
            ),
        );
    }
}
