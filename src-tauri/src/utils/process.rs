use crate::infrastructure::logging::logger as logs;

/// Registers a process ID for tracking
pub fn register_pid(name: &str, pid: u32) {
    logs::add_log(&format!("Registered {name} PID: {pid}"), "Process", "info");
}
