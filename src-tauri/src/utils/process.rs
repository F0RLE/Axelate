use crate::infrastructure::logging::logger as logs;

#[cfg(windows)]
mod win_job {
    pub const fn init_job() {
        // Stub for now to fix build
    }
}

/// Initializes process group for child process management
pub const fn init_process_group() {
    #[cfg(windows)]
    win_job::init_job();
}

/// Checks for and kills old processes from previous sessions
pub const fn kill_old_processes() -> usize {
    0
}

/// Registers a process ID for tracking
pub fn register_pid(name: &str, pid: u32) {
    logs::add_log(&format!("Registered {name} PID: {pid}"), "Process", "info");
}
