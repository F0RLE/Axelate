//! Main build script for Axelate
//!
//! Handles Tauri build process and other compile-time guarantees.

fn main() {
    // Watch resource files for changes to trigger rebuild during dev
    println!("cargo:rerun-if-changed=resources/config/app.json");
    println!("cargo:rerun-if-changed=resources/config/local_modules.json");
    println!("cargo:rerun-if-changed=resources/locales");
    println!("cargo:rerun-if-changed=resources/api_providers.json");

    tauri_build::build();
}
