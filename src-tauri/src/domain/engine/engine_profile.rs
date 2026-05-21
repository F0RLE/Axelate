pub(super) const LLAMACPP_MIN_CONTEXT_SIZE: u32 = 4096;

pub(super) fn minimum_context_size(engine_id: &str) -> Option<u32> {
    match engine_id {
        "llamacpp" => Some(LLAMACPP_MIN_CONTEXT_SIZE),
        _ => None,
    }
}
