use std::num::NonZeroUsize;

/// Checks if a process is running using lightweight OS-level APIs.
pub fn is_running(pid: usize) -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, FALSE};
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        // Standard Windows constant for process still running
        const STILL_ACTIVE: u32 = 259u32;

        #[allow(unsafe_code)]
        unsafe {
            let handle = OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION,
                FALSE,
                u32::try_from(pid).unwrap_or(u32::MAX),
            );
            if handle.is_null() {
                return false;
            }

            let mut exit_code = 0u32;
            let success = GetExitCodeProcess(handle, &raw mut exit_code);
            CloseHandle(handle);

            success != FALSE && exit_code == STILL_ACTIVE
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On Unix, kill(pid, 0) is the standard way to check if a process exists.
        // If it returns 0, the process exists.
        // If it returns -1 and errno is EPERM, the process exists but we can't signal it.
        unsafe {
            let res = libc::kill(pid as libc::pid_t, 0);
            if res == 0 {
                return true;
            }
            // Use portable std::io::Error to check for EPERM
            std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
        }
    }
}

/// Helper to convert usize PID to platform-specific PID type
pub const fn to_native_pid(pid: usize) -> Option<NonZeroUsize> {
    NonZeroUsize::new(pid)
}

/// Kills an orphan process (one not in our registry) using OS-level APIs.
/// Includes an existence check to avoid killing recycled PIDs.
pub fn kill_orphan(pid: usize) -> Result<String, String> {
    if !is_running(pid) {
        return Ok(format!("Process {pid} already exited, skip kill"));
    }

    tracing::info!("Killing orphan process PID: {pid}");

    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, FALSE, GetLastError};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_TERMINATE, TerminateProcess,
        };

        #[allow(unsafe_code)]
        unsafe {
            let handle = OpenProcess(
                PROCESS_TERMINATE,
                FALSE,
                u32::try_from(pid).unwrap_or(u32::MAX),
            );
            if handle.is_null() {
                return Err(format!(
                    "Failed to open process {pid}: error {}",
                    GetLastError()
                ));
            }

            let result = TerminateProcess(handle, 1);
            CloseHandle(handle);

            if result == FALSE {
                Err(format!(
                    "Failed to terminate process {pid}: error {}",
                    GetLastError()
                ))
            } else {
                Ok(format!("Successfully killed orphan PID {pid}"))
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        unsafe {
            if libc::kill(pid as libc::pid_t, libc::SIGKILL) == 0 {
                Ok(format!("Successfully killed orphan PID {pid}"))
            } else {
                Err(format!("Failed to kill orphan PID {pid}"))
            }
        }
    }
}

