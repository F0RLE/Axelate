use serde::{Deserialize, Serialize};
use specta::Type;
use std::fmt::Write;
use std::io::Read;
use zip::ZipArchive;

const IGNORE_DIRS: &[&str] = &[
    "node_modules/",
    ".git/",
    ".svn/",
    "dist/",
    "build/",
    ".next/",
    ".astro/",
    "target/",
];
const IGNORE_FILES: &[&str] = &[
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "Cargo.lock",
    ".DS_Store",
];
const TEXT_EXTS: &[&str] = &[
    "js", "ts", "jsx", "tsx", "py", "md", "json", "html", "css", "txt", "xml", "yaml", "yml", "rs",
    "go", "java", "c", "cpp", "h", "sh", "sql", "toml", "env", "config", "ini", "bat", "ps1",
];

const MAX_TOTAL_UNCOMPRESSED_SIZE: usize = 100 * 1024 * 1024; // 100MB
const MAX_EXTRACTED_FILE_SIZE: usize = 50 * 1024; // 50KB per file to avoid context bloating

/// Processed file content result
#[derive(Debug, Serialize, Deserialize, Type)]
pub struct ProcessedFile {
    /// File name
    pub name: String,
    /// Extracted text content
    pub content: String,
    /// Whether file was a ZIP archive
    pub is_archive: bool,
    /// Processing error if any
    pub error: Option<String>,
}

#[tauri::command]
#[specta::specta]
/// Processes file content for AI context (extracts text from files and archives)
pub async fn process_file_content(name: String, data: Vec<u8>) -> Result<ProcessedFile, String> {
    let lower_name = name.to_lowercase();

    // 1. Check if it is a ZIP archive
    if std::path::Path::new(&lower_name)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
    {
        return process_zip(name, data);
    }

    // 2. Check if text file
    if is_text_extension(&lower_name) {
        match String::from_utf8(data) {
            Ok(s) => {
                return Ok(ProcessedFile {
                    name,
                    content: s,
                    is_archive: false,
                    error: None,
                });
            }
            Err(_) => {
                return Ok(ProcessedFile {
                    name,
                    content: "[Binary or non-UTF8 content skipped]".to_string(),
                    is_archive: false,
                    error: Some("Encoding error".to_string()),
                });
            }
        }
    }

    // 3. Fallback for images/binary (User just wants to attach them, not extract text)
    // We return empty content for text-context purposes, but frontend handles the attachment metadata.
    Ok(ProcessedFile {
        name,
        content: String::new(),
        is_archive: false,
        error: None,
    })
}

fn process_zip(name: String, data: Vec<u8>) -> Result<ProcessedFile, String> {
    let reader = std::io::Cursor::new(data);
    let mut archive =
        ZipArchive::new(reader).map_err(|e| format!("Failed to read archive: {e}"))?;

    let mut combined_text = format!("\n\n--- ARCHIVE: {name} (Smart Unpacked) ---\n");
    let mut total_size = 0;

    // Generate Structure Map
    combined_text.push_str("\nStructure Map:\n");
    let file_names: Vec<String> = archive.file_names().map(ToString::to_string).collect();
    // Simple sort
    let mut sorted_names = file_names;
    sorted_names.sort();

    for path in &sorted_names {
        let is_dir = path.ends_with('/');
        let depth = path.split('/').filter(|s| !s.is_empty()).count();
        let indent = "  ".repeat(if depth > 0 { depth - 1 } else { 0 });
        let icon = if is_dir { "📁 " } else { "📄 " };
        let name_part = path.split('/').rfind(|s| !s.is_empty()).unwrap_or(path);

        use std::fmt::Write;
        let _ = writeln!(combined_text, "{indent}{icon}{name_part}");
    }

    combined_text.push_str("\n--- START EXTRACTED FILES ---\n");

    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| e.to_string())?;
        let file_name = file.name().to_string();

        if should_ignore(&file_name) {
            continue;
        }

        if file.is_dir() {
            continue;
        }

        if file.size() > MAX_EXTRACTED_FILE_SIZE as u64 {
            let _ = write!(
                combined_text,
                "\n[Skipped: {file_name} - Too large ({}KB)]\n",
                file.size() / 1024
            );
            continue;
        }

        // Read content
        let mut buffer = Vec::new(); // Limit reading?
        // Safety: We check file.size() above, but compressed data *could* lie?
        // ZipArchive handles CRC check. We should enforce read limit.
        let mut handle = file.take(MAX_EXTRACTED_FILE_SIZE as u64 + 1);
        handle.read_to_end(&mut buffer).map_err(|e| e.to_string())?;

        if buffer.len() > MAX_EXTRACTED_FILE_SIZE {
            let _ = write!(
                combined_text,
                "\n[Skipped: {file_name} - Size limit exceeded]\n"
            );
            continue;
        }

        total_size += buffer.len();
        if total_size > MAX_TOTAL_UNCOMPRESSED_SIZE {
            combined_text.push_str("\n[CRITICAL: Zip Bomb detection - Aborted extraction]\n");
            break;
        }

        if let Ok(content) = String::from_utf8(buffer) {
            let ext = file_name.split('.').next_back().unwrap_or("");
            let _ = write!(
                combined_text,
                "\n\nFile: {file_name}\n```{ext}\n{content}\n```"
            );
        } else {
            let _ = write!(combined_text, "\n[Skipped: {file_name} - Binary]\n");
        }
    }

    let _ = write!(combined_text, "\n--- END ARCHIVE {name} ---\n");

    Ok(ProcessedFile {
        name,
        content: combined_text,
        is_archive: true,
        error: None,
    })
}

fn should_ignore(path: &str) -> bool {
    // Check dirs
    for dir in IGNORE_DIRS {
        if path.contains(dir) {
            return true;
        }
    }
    // Check files
    for f in IGNORE_FILES {
        if path.ends_with(f) {
            return true;
        }
    }
    // Check extensions logic (whitelist approach usually better for code, but here we used blacklist mixed)
    // Actually ChatFileHandler used TEXT_EXTS whitelist.
    let ext = path.split('.').next_back().unwrap_or("").to_lowercase();
    if !TEXT_EXTS.contains(&ext.as_str()) {
        return true;
    }

    false
}

fn is_text_extension(path: &str) -> bool {
    let ext = path.split('.').next_back().unwrap_or("").to_lowercase();
    TEXT_EXTS.contains(&ext.as_str())
}
