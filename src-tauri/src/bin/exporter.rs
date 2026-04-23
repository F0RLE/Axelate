//! Standalone utility to export TypeScript bindings for the Axelate project.

use axelate_lib::{TYPESCRIPT_BINDINGS_PATH, create_specta_builder, export_typescript_bindings};
use std::{env, fs, io, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let builder = create_specta_builder();

    if env::args().skip(1).any(|arg| arg == "--check") {
        verify_typescript_bindings(&builder)?;
        return Ok(());
    }

    export_typescript_bindings(&builder, TYPESCRIPT_BINDINGS_PATH)?;
    Ok(())
}

fn verify_typescript_bindings(
    builder: &tauri_specta::Builder<tauri::Wry>,
) -> Result<(), Box<dyn std::error::Error>> {
    let temp_dir = tempfile::tempdir()?;
    let generated_path = temp_dir.path().join("bindings.ts");
    export_typescript_bindings(builder, &generated_path)?;

    let current_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(TYPESCRIPT_BINDINGS_PATH);
    let generated = fs::read_to_string(&generated_path)?;
    let current = fs::read_to_string(&current_path)?;

    if current != generated {
        return Err(io::Error::other(
            "TypeScript bindings are stale. Run `npm --prefix src run bindings:sync`.",
        )
        .into());
    }

    Ok(())
}
