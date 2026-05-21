use std::ffi::{OsStr, OsString};
use std::num::NonZeroUsize;
use std::path::Path;
use sysinfo::System;

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

/// Finds running Python-like processes that execute the given script module entry from the
/// provided module directory.
pub fn find_script_module_processes(module_path: &Path, entry_path: &Path) -> Vec<usize> {
    let mut system = System::new_all();
    system.refresh_all();

    system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            let process_name = process.name().to_string_lossy();
            if !is_python_like_process(&process_name) {
                return None;
            }
            if !process_matches_module(process, module_path, entry_path) {
                return None;
            }
            Some(pid.as_u32() as usize)
        })
        .collect()
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

fn is_python_like_process(process_name: &str) -> bool {
    let normalized = normalize_str(process_name);
    normalized.contains("python")
}

fn command_targets_entry(cmd: &[OsString], module_path: &Path, entry_path: &Path) -> bool {
    if cmd.is_empty() {
        return false;
    }

    let normalized_entry = normalize_path(entry_path);
    let normalized_relative_entry = entry_path
        .strip_prefix(module_path)
        .ok()
        .map(normalize_path);
    let entry_file_name = entry_path.file_name().map(normalize_os_str);

    cmd.iter().any(|arg| {
        let normalized_arg = normalize_os_str(arg);
        if normalized_arg.is_empty() {
            return false;
        }

        normalized_arg == normalized_entry
            || normalized_relative_entry
                .as_ref()
                .is_some_and(|relative| normalized_arg.ends_with(relative))
            || entry_file_name
                .as_ref()
                .is_some_and(|file_name| normalized_arg.ends_with(file_name))
    })
}

fn process_matches_module(
    process: &sysinfo::Process,
    module_path: &Path,
    entry_path: &Path,
) -> bool {
    let cmd = process.cmd();
    if !command_targets_entry(cmd, module_path, entry_path) {
        return false;
    }

    if process.cwd().is_some_and(|cwd| same_path(cwd, module_path)) {
        return true;
    }

    command_mentions_module_path(cmd, module_path)
}

fn command_mentions_module_path(cmd: &[OsString], module_path: &Path) -> bool {
    let normalized_module_path = normalize_path(module_path);
    cmd.iter().any(|arg| {
        let normalized_arg = normalize_os_str(arg);
        !normalized_arg.is_empty() && normalized_arg.contains(&normalized_module_path)
    })
}

fn same_path(left: &Path, right: &Path) -> bool {
    normalize_path(left) == normalize_path(right)
}

fn normalize_path(path: &Path) -> String {
    normalize_str(&path.as_os_str().to_string_lossy())
}

fn normalize_os_str(value: &OsStr) -> String {
    normalize_str(&value.to_string_lossy())
}

fn normalize_str(value: &str) -> String {
    let normalized = value.replace('\\', "/");

    #[cfg(target_os = "windows")]
    {
        normalized.to_ascii_lowercase()
    }

    #[cfg(not(target_os = "windows"))]
    {
        normalized
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::{command_mentions_module_path, command_targets_entry, same_path};
    use std::ffi::OsString;
    use std::path::Path;

    #[test]
    fn command_targets_entry_accepts_absolute_and_relative_script_paths() {
        let module_path = Path::new("C:/Axelate/Modules/sample-integration");
        let entry_path = module_path.join("src/main.py");

        let absolute = vec![
            OsString::from("python.exe"),
            OsString::from("C:/Axelate/Modules/sample-integration/src/main.py"),
        ];
        assert!(command_targets_entry(&absolute, module_path, &entry_path));

        let relative = vec![OsString::from("python.exe"), OsString::from("src/main.py")];
        assert!(command_targets_entry(&relative, module_path, &entry_path));
    }

    #[test]
    fn same_path_normalizes_windows_separators_and_case() {
        let left = Path::new("C:/Axelate/Modules/SampleIntegration");
        let right = Path::new("c:\\axelate\\modules\\sampleintegration");

        assert!(same_path(left, right));
    }

    #[test]
    fn command_mentions_module_path_accepts_absolute_module_path_in_args() {
        let module_path = Path::new("C:/Axelate/Modules/SampleIntegration");
        let cmd = vec![
            OsString::from("python.exe"),
            OsString::from("C:/Axelate/Modules/SampleIntegration/src/main.py"),
        ];

        assert!(command_mentions_module_path(&cmd, module_path));
    }
}
