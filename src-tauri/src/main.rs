//! Axelate Application Entry Point
//!
//! Initializes the Tauri application, system tray, and background services.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    axelate_lib::run();
}
