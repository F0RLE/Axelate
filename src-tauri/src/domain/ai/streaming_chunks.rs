use super::provider_response;
use super::streaming::{StreamEvent, StreamSink};
use super::types::TokenUsage;

pub(super) struct StreamingAccumulator {
    pub(super) full_content: String,
    pub(super) buffer: String,
    pub(super) final_usage: Option<TokenUsage>,
    pub(super) saw_terminal_chunk: bool,
    pub(super) chunks_emitted: u32,
    pub(super) started_at: std::time::Instant,
    pub(super) first_chunk_after: Option<std::time::Duration>,
}

impl StreamingAccumulator {
    pub(super) fn new() -> Self {
        Self {
            full_content: String::new(),
            buffer: String::new(),
            final_usage: None,
            saw_terminal_chunk: false,
            chunks_emitted: 0,
            started_at: std::time::Instant::now(),
            first_chunk_after: None,
        }
    }

    fn record_chat_chunk(&mut self, content: &str) {
        if content.is_empty() {
            return;
        }

        if self.first_chunk_after.is_none() {
            self.first_chunk_after = Some(self.started_at.elapsed());
        }
        self.chunks_emitted = self.chunks_emitted.saturating_add(1);
        self.full_content.push_str(content);
    }
}

pub(super) enum StreamChunkResult {
    Continue,
    Done,
    Error(String),
}

pub(super) fn process_stream_chunk(
    chunk: &[u8],
    message_id: &str,
    sink: &dyn StreamSink,
    state: &mut StreamingAccumulator,
) -> StreamChunkResult {
    let chunk_str = String::from_utf8_lossy(chunk);

    if state.buffer.len() + chunk_str.len() > 1_024_024 {
        tracing::error!("[AI] Stream buffer overflow protection triggered. Clearing buffer.");
        state.buffer.clear();
    }

    state.buffer.push_str(&chunk_str);

    while let Some(pos) = state.buffer.find('\n') {
        let line = state.buffer[..pos].trim().to_string();
        state.buffer.drain(..=pos);

        match process_stream_line(&line, message_id, sink, state) {
            StreamChunkResult::Continue => {}
            result => return result,
        }
    }

    StreamChunkResult::Continue
}

pub(super) fn process_trailing_stream_buffer(
    message_id: &str,
    sink: &dyn StreamSink,
    state: &mut StreamingAccumulator,
) -> StreamChunkResult {
    let line = state.buffer.trim().to_string();
    state.buffer.clear();

    if line.is_empty() {
        return StreamChunkResult::Continue;
    }

    process_stream_line(&line, message_id, sink, state)
}

fn process_stream_line(
    line: &str,
    message_id: &str,
    sink: &dyn StreamSink,
    state: &mut StreamingAccumulator,
) -> StreamChunkResult {
    if line.is_empty() || line.starts_with(':') || line.starts_with("event:") {
        return StreamChunkResult::Continue;
    }

    let Some(data) = line.strip_prefix("data:").map(str::trim) else {
        return StreamChunkResult::Continue;
    };

    if data == "[DONE]" {
        return StreamChunkResult::Done;
    }

    handle_stream_json_line(data, message_id, sink, state)
}

fn handle_stream_json_line(
    data: &str,
    message_id: &str,
    sink: &dyn StreamSink,
    state: &mut StreamingAccumulator,
) -> StreamChunkResult {
    let json = serde_json::from_str::<serde_json::Value>(data).map_err(|error| {
        tracing::debug!("[AI] Failed to parse stream JSON chunk: {error}");
        format!("AI stream returned malformed JSON chunk: {error}")
    });
    let Ok(json) = json else {
        return StreamChunkResult::Error("AI stream returned malformed JSON chunk".to_string());
    };

    if let Some(message) = provider_response::extract_stream_error_message(&json) {
        return StreamChunkResult::Error(message);
    }

    if let Some(usage) = provider_response::extract_token_usage(&json) {
        state.final_usage = Some(usage);
    }

    let choice = json
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first());

    if let Some(choice) = choice {
        if let Some(message) = choice
            .get("error")
            .and_then(provider_response::extract_error_message)
        {
            return StreamChunkResult::Error(message);
        }

        if let Some(finish_reason) = choice.get("finish_reason").and_then(|value| value.as_str()) {
            if finish_reason.eq_ignore_ascii_case("error") {
                return StreamChunkResult::Error(
                    provider_response::extract_error_message(choice)
                        .unwrap_or_else(|| "AI provider reported a streaming error".to_string()),
                );
            }

            if !finish_reason.trim().is_empty() {
                state.saw_terminal_chunk = true;
            }
        }
    }

    if json
        .get("stop")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
        || json
            .get("done")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    {
        state.saw_terminal_chunk = true;
    }

    let delta = choice.and_then(|value| value.get("delta"));

    if let Some(reasoning) = delta
        .and_then(|d| d.get("reasoning_content"))
        .and_then(provider_response::extract_stream_text)
        .or_else(|| {
            delta
                .and_then(|d| d.get("reasoning"))
                .and_then(provider_response::extract_stream_text)
        })
    {
        sink.emit(StreamEvent::ThoughtChunk {
            message_id: message_id.to_string(),
            content: reasoning,
        });
    }

    let content = delta
        .and_then(|d| d.get("content"))
        .and_then(provider_response::extract_stream_text)
        .or_else(|| {
            choice
                .and_then(|value| value.get("text"))
                .and_then(provider_response::extract_stream_text)
                .or_else(|| {
                    choice
                        .and_then(|value| value.get("content"))
                        .and_then(provider_response::extract_stream_text)
                })
        })
        .or_else(|| {
            json.get("content")
                .and_then(provider_response::extract_stream_text)
        })
        .or_else(|| {
            json.get("message")
                .and_then(|message| message.get("content"))
                .and_then(provider_response::extract_stream_text)
        })
        .or_else(|| {
            json.get("response")
                .and_then(provider_response::extract_stream_text)
        })
        .or_else(|| {
            json.get("delta")
                .and_then(|delta| delta.get("content"))
                .and_then(provider_response::extract_stream_text)
        })
        .or_else(|| {
            json.get("token")
                .and_then(|token| token.get("text"))
                .and_then(provider_response::extract_stream_text)
        });

    if let Some(content) = content {
        state.record_chat_chunk(&content);
        sink.emit(StreamEvent::ChatChunk {
            message_id: message_id.to_string(),
            content,
        });
    }

    StreamChunkResult::Continue
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::{StreamChunkResult, StreamingAccumulator, process_stream_chunk};
    use crate::domain::ai::{StreamEvent, StreamSink};

    #[derive(Default)]
    struct TestSink {
        events: std::sync::Mutex<Vec<StreamEvent>>,
    }

    impl StreamSink for TestSink {
        fn emit(&self, event: StreamEvent) {
            self.events.lock().expect("sink mutex").push(event);
        }
    }

    #[test]
    fn process_stream_chunk_surfaces_provider_errors() {
        let sink = TestSink::default();
        let mut state = StreamingAccumulator::new();
        let chunk = b"data: {\"error\":{\"message\":\"rate limited\"}}\n\n".as_slice();

        let result = process_stream_chunk(chunk, "msg-1", &sink, &mut state);

        assert!(matches!(result, StreamChunkResult::Error(message) if message == "rate limited"));
    }

    #[test]
    fn process_stream_chunk_collects_content_and_terminal_reason() {
        let sink = TestSink::default();
        let mut state = StreamingAccumulator::new();
        let chunk = b"data: {\"choices\":[{\"delta\":{\"content\":\"hello\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\n";

        let result = process_stream_chunk(chunk, "msg-1", &sink, &mut state);

        assert!(matches!(result, StreamChunkResult::Continue));
        assert_eq!(state.full_content, "hello");
        assert!(state.saw_terminal_chunk);
        assert_eq!(
            state.final_usage.as_ref().map(|usage| usage.total_tokens),
            Some(3)
        );

        let events = sink.events.lock().expect("sink events");
        assert!(matches!(
            events.first(),
            Some(StreamEvent::ChatChunk { content, .. }) if content == "hello"
        ));
    }

    #[test]
    fn process_stream_chunk_normalizes_ollama_usage() {
        let sink = TestSink::default();
        let mut state = StreamingAccumulator::new();
        let chunk = b"data: {\"message\":{\"content\":\"hello\"},\"done\":true,\"prompt_eval_count\":7,\"eval_count\":11}\n\n";

        let result = process_stream_chunk(chunk, "msg-1", &sink, &mut state);

        assert!(matches!(result, StreamChunkResult::Continue));
        assert_eq!(state.full_content, "hello");
        assert!(state.saw_terminal_chunk);
        let usage = state.final_usage.expect("usage");
        assert_eq!(usage.prompt_tokens, 7);
        assert_eq!(usage.completion_tokens, 11);
        assert_eq!(usage.total_tokens, 18);

        let events = sink.events.lock().expect("sink events");
        assert!(matches!(
            events.first(),
            Some(StreamEvent::ChatChunk { content, .. }) if content == "hello"
        ));
    }

    #[test]
    fn process_stream_chunk_supports_ollama_message_content() {
        let sink = TestSink::default();
        let mut state = StreamingAccumulator::new();
        let chunk = b"data: {\"message\":{\"content\":\"hello from ollama\"},\"done\":true}\n\n";

        let result = process_stream_chunk(chunk, "msg-1", &sink, &mut state);

        assert!(matches!(result, StreamChunkResult::Continue));
        assert_eq!(state.full_content, "hello from ollama");
        assert!(state.saw_terminal_chunk);

        let events = sink.events.lock().expect("sink events");
        assert!(matches!(
            events.first(),
            Some(StreamEvent::ChatChunk { content, .. }) if content == "hello from ollama"
        ));
    }

    #[test]
    fn process_stream_chunk_normalizes_llama_cpp_timings_usage() {
        let sink = TestSink::default();
        let mut state = StreamingAccumulator::new();
        let chunk = b"data: {\"content\":\"done\",\"stop\":true,\"timings\":{\"prompt_n\":5,\"predicted_n\":13}}\n\n";

        let result = process_stream_chunk(chunk, "msg-1", &sink, &mut state);

        assert!(matches!(result, StreamChunkResult::Continue));
        let usage = state.final_usage.expect("usage");
        assert_eq!(usage.prompt_tokens, 5);
        assert_eq!(usage.completion_tokens, 13);
        assert_eq!(usage.total_tokens, 18);
    }

    #[test]
    fn process_stream_chunk_supports_llama_style_top_level_content() {
        let sink = TestSink::default();
        let mut state = StreamingAccumulator::new();
        let chunk = b"data: {\"content\":\"hello\",\"stop\":false}\n\ndata: {\"content\":\" world\",\"stop\":true}\n\n";

        let result = process_stream_chunk(chunk, "msg-1", &sink, &mut state);

        assert!(matches!(result, StreamChunkResult::Continue));
        assert_eq!(state.full_content, "hello world");
        assert!(state.saw_terminal_chunk);
        assert_eq!(state.chunks_emitted, 2);

        let events = sink.events.lock().expect("sink events");
        assert_eq!(events.len(), 2);
        assert!(matches!(
            events.first(),
            Some(StreamEvent::ChatChunk { content, .. }) if content == "hello"
        ));
        assert!(matches!(
            events.get(1),
            Some(StreamEvent::ChatChunk { content, .. }) if content == " world"
        ));
    }

    #[test]
    fn process_stream_chunk_supports_top_level_delta_content() {
        let sink = TestSink::default();
        let mut state = StreamingAccumulator::new();
        let chunk = b"data: {\"delta\":{\"content\":\"delta text\"}}\n\n";

        let result = process_stream_chunk(chunk, "msg-1", &sink, &mut state);

        assert!(matches!(result, StreamChunkResult::Continue));
        assert_eq!(state.full_content, "delta text");
    }
}
