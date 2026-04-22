//! Standalone utility to export TypeScript bindings for the Axelate project.

use axelate_lib::{TYPESCRIPT_BINDINGS_PATH, create_specta_builder, export_typescript_bindings};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let builder = create_specta_builder();
    export_typescript_bindings(&builder, TYPESCRIPT_BINDINGS_PATH)?;

    #[allow(clippy::print_stdout)]
    {
        println!("Bindings exported successfully!");
    }
    Ok(())
}
