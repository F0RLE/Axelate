//! Sequential request queue
//!
//! All AI requests (from chat, scripts, or services) go through this queue.
//! Requests are processed one at a time. If the active engine doesn't match
//! the required capability, a hot-swap is triggered.

use std::collections::VecDeque;
use std::sync::Arc;

use tokio::sync::{Mutex, mpsc};
use tracing::info;

use super::types::{Capability, QueuedRequest, RequestSource};

/// Queue position info for frontend
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct QueuePosition {
    /// Request ID
    pub request_id: String,
    /// Position in queue (0 = currently processing)
    pub position: usize,
    /// Total queue size
    pub total: usize,
}

/// Sequential request queue
pub struct RequestQueue {
    /// Pending requests
    queue: Arc<Mutex<VecDeque<QueuedRequest>>>,
    /// Notify channel for new requests
    notify_tx: mpsc::UnboundedSender<()>,
}

impl std::fmt::Debug for RequestQueue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RequestQueue").finish()
    }
}

impl RequestQueue {
    /// Creates a new request queue and returns (queue, receiver)
    pub fn new() -> (Self, mpsc::UnboundedReceiver<()>) {
        let (notify_tx, notify_rx) = mpsc::unbounded_channel();
        (
            Self {
                queue: Arc::new(Mutex::new(VecDeque::new())),
                notify_tx,
            },
            notify_rx,
        )
    }

    /// Add a request to the queue
    pub async fn enqueue(&self, request: QueuedRequest) -> usize {
        let mut queue = self.queue.lock().await;

        // Insert based on priority (Chat before Script)
        let position = match request.source {
            RequestSource::Chat => {
                // Insert after other chat requests but before script requests
                let pos = queue
                    .iter()
                    .position(|r| matches!(r.source, RequestSource::Script))
                    .unwrap_or(queue.len());
                queue.insert(pos, request);
                pos
            }
            RequestSource::Script => {
                queue.push_back(request);
                queue.len() - 1
            }
        };

        // Notify processor
        let _ = self.notify_tx.send(());

        info!(position, total = queue.len(), "Request enqueued");
        position
    }

    /// Take the next request from the queue
    pub async fn dequeue(&self) -> Option<QueuedRequest> {
        self.queue.lock().await.pop_front()
    }

    /// Reorder queue to minimize engine swaps:
    /// Groups consecutive same-capability requests together
    pub async fn optimize(&self) {
        let mut queue = self.queue.lock().await;
        if queue.len() < 3 {
            return;
        }

        // Stable sort by capability, preserving priority order within same capability
        let mut items: Vec<QueuedRequest> = queue.drain(..).collect();
        items.sort_by(|a, b| {
            // First by source priority (Chat < Script)
            let pa = match a.source {
                RequestSource::Chat => 0,
                RequestSource::Script => 1,
            };
            let pb = match b.source {
                RequestSource::Chat => 0,
                RequestSource::Script => 1,
            };
            pa.cmp(&pb)
                // Then group same capability together
                .then_with(|| capability_ord(a.capability).cmp(&capability_ord(b.capability)))
        });

        for item in items {
            queue.push_back(item);
        }

        info!(size = queue.len(), "Queue optimized");
    }

    /// Get current queue length
    pub async fn len(&self) -> usize {
        self.queue.lock().await.len()
    }

    /// Check if queue is empty
    pub async fn is_empty(&self) -> bool {
        self.queue.lock().await.is_empty()
    }

    /// Get position of a request by ID
    pub async fn position_of(&self, request_id: &str) -> Option<QueuePosition> {
        let queue = self.queue.lock().await;
        let total = queue.len();
        queue
            .iter()
            .position(|r| r.id == request_id)
            .map(|position| QueuePosition {
                request_id: request_id.to_string(),
                position,
                total,
            })
    }

    /// Peek at the next request's required capability (without removing)
    pub async fn peek_capability(&self) -> Option<Capability> {
        self.queue.lock().await.front().map(|r| r.capability)
    }
}

/// Ordering helper for capability grouping
const fn capability_ord(cap: Capability) -> u8 {
    match cap {
        Capability::Text => 0,
        Capability::Vision => 1,
        Capability::Image => 2,
    }
}
