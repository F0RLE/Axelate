//! Engine type definitions
//!
//! Core types for the engine management subsystem.
//! These represent capabilities, configurations, and runtime state
//! of local inference engines (llama.cpp, sd.cpp, etc.).

use serde::{Deserialize, Serialize};
use specta::Type;

/// What an engine can do
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Capability {
    /// Text generation (LLM)
    Text,
    /// Image generation (diffusion)
    Image,
    /// Image understanding (multimodal LLM)
    Vision,
}

/// Engine runtime kind
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind")]
pub enum EngineKind {
    /// Local process (spawned binary)
    Local {
        /// Binary name (e.g. "llama-server")
        binary: String,
        /// Port to bind
        port: u16,
    },
    /// Cloud API endpoint
    Cloud {
        /// Base URL (e.g. "https://openrouter.ai/api/v1")
        base_url: String,
    },
}

/// Static engine definition (from local_modules.json)
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EngineDefinition {
    /// Unique identifier (e.g. "llamacpp")
    pub id: String,
    /// Display name
    pub name: String,
    /// Description
    #[serde(default)]
    pub desc: String,
    /// Icon emoji
    #[serde(default)]
    pub icon: String,
    /// What this engine can do
    #[serde(default)]
    pub capabilities: Vec<Capability>,
    /// Binary name for local engines
    #[serde(default)]
    pub binary: Option<String>,
    /// GitHub repository URL (for releases/downloads)
    #[serde(default)]
    pub repo_url: Option<String>,
    /// Current version
    #[serde(default = "default_version")]
    pub version: String,
    /// Default port (extracted from configSchema.port.default)
    #[serde(default = "default_port")]
    pub default_port: u16,
    /// Default GPU layers (-1 = all, extracted from configSchema.gpuLayers.default)
    #[serde(default = "default_gpu_layers")]
    pub default_gpu_layers: i32,
    /// Default context window size (extracted from configSchema.contextSize.default)
    #[serde(default = "default_context_size")]
    pub default_context_size: u32,
    /// Raw configuration schema for UI rendering (kept for frontend)
    #[serde(default)]
    pub config_schema: Option<serde_json::Value>,
    /// Whether the engine binary is currently installed (populated at runtime, not from JSON)
    #[serde(default)]
    pub installed: bool,
}

fn default_version() -> String {
    "1.0.0".to_string()
}

/// Runtime configuration for starting an engine
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EngineConfig {
    /// Engine identifier (matches EngineDefinition.id)
    pub engine_id: String,
    /// Number of GPU layers (-1 = all)
    #[serde(default = "default_gpu_layers")]
    pub gpu_layers: i32,
    /// Context window size
    #[serde(default = "default_context_size")]
    pub context_size: u32,
    /// Path to model file
    pub model_path: Option<String>,
    /// Extra CLI arguments
    #[serde(default)]
    pub extra_args: Vec<String>,
}

/// Currently running engine
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EngineStatus {
    /// Engine identifier
    pub id: String,
    /// Display name
    pub name: String,
    /// Capabilities
    pub capabilities: Vec<Capability>,
    /// HTTP endpoint (e.g. "http://localhost:8081")
    pub endpoint: String,
    /// Is the engine healthy and ready
    pub healthy: bool,
}

/// Engine lifecycle state (for frontend)
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EngineState {
    /// No engine loaded
    Idle,
    /// Engine is starting up
    Starting {
        /// ID of the engine being started
        engine_id: String,
    },
    /// Swapping from one engine to another within a slot
    Swapping {
        /// ID of the engine being stopped
        from: String,
        /// ID of the engine being started
        to: String,
    },
    /// One or more engines are running
    Ready {
        /// Active slots (one per capability)
        slots: Vec<SlotStatus>,
    },
    /// Engine encountered an error
    Error {
        /// ID of the failed engine
        engine_id: String,
        /// Error description
        message: String,
    },
}

/// Status of a single capability slot
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SlotStatus {
    /// Which capability this slot serves
    pub capability: Capability,
    /// Engine running in this slot
    pub engine: EngineStatus,
}

const fn default_port() -> u16 {
    8081
}

const fn default_gpu_layers() -> i32 {
    -1
}

const fn default_context_size() -> u32 {
    4096
}
