#![allow(unsafe_code)]
/**
 * @module utils/memory
 * @description Utilities for managing process memory footprint
 */
#[cfg(target_os = "windows")]
pub fn trim_memory() {
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, SetProcessWorkingSetSize};

    unsafe {
        let process = GetCurrentProcess();
        // Invoke system call to minimize process working set.
        // Passing usize::MAX triggers the memory manager to reclaim as many pages as possible,
        // effectively paging non-critical data to disk for tray backgrounding efficiency.
        SetProcessWorkingSetSize(process, usize::MAX, usize::MAX);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn trim_memory() {
    // No-op for other OSs
}
