use crate::services::logs;

#[cfg(windows)]
mod win_job {
    pub fn init_job() {
        // Stub for now to fix build
    }
}

pub fn init_process_group() {
    #[cfg(windows)]
    win_job::init_job();
}

pub fn kill_old_processes() -> usize {
    // В Rust Tauri мы можем полагаться на то, что старые процессы убиваются самим Tauri
    // или использовать более простую логику проверки PID файлов если они остались.
    // Пока оставим заглушку, так как Tauri обычно хорошо справляется с этим.
    0
}

pub fn register_pid(name: &str, pid: u32) {
    logs::add_log(
        &format!("Registered {} PID: {}", name, pid),
        "Process",
        "info",
    );
}
