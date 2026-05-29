/// Returns the normalized engine registry id.
pub fn canonical_engine_id(engine_id: &str) -> String {
    let normalized = engine_id
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '.', '_'], "-");

    let mut normalized = normalized;
    while normalized.contains("--") {
        normalized = normalized.replace("--", "-");
    }

    normalized
}

pub(super) fn canonical_engine_log_id(engine_id: &str) -> String {
    canonical_engine_id(engine_id)
}

#[cfg(test)]
mod tests {
    use super::canonical_engine_id;

    #[test]
    fn canonical_engine_id_normalizes_without_remapping_cpp_engines() {
        assert_eq!(canonical_engine_id(" sdcpp "), "sdcpp");
        assert_eq!(canonical_engine_id("llama cpp"), "llama-cpp");
        assert_eq!(canonical_engine_id("llama_cpp"), "llama-cpp");
        assert_eq!(canonical_engine_id("llama.cpp"), "llama-cpp");
        assert_eq!(canonical_engine_id("sd.cpp"), "sd-cpp");
    }
}
