/**
 * @module ai/types/aiTypes
 * @description Domain-specific type definitions and contracts for the AI module infrastructure.
 */

// ============================================================================
// Communication Contracts
// ============================================================================

/**
 * Identifies the logical origin of a message within the routing pipeline.
 */
export type MessageSource = 'chat' | 'service' | 'system';

/**
 * Functional interface for asynchronous message broadcast consumption.
 */
export type MessageHandler = (response: string, source: MessageSource) => void;

/**
 * Functional interface for streaming chunk consumption.
 */
export type IChunkHandler = (chunk: string) => void;

/**
 * Discrete component of a multimodal message payload.
 */
export type ChatContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
    | { type: 'file'; data?: string; mime: string; name?: string };

/**
 * Union type facilitating polymorphic content ingestion for chat iterations.
 */
export type ChatContent = string | ChatContentPart[];

/**
 * Structural contract for individual conversation tokens.
 */
export interface IChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: ChatContent;
    thought_signature?: string | undefined;
}

// ============================================================================
// IPC Transfer Envelopes
// ============================================================================

/**
 * Aggregated payload for secure cross-origin chat requests.
 */
export interface IChatRequest {
    provider: string;
    model: string;
    messages: { role: string; content: ChatContent; thought_signature?: string | undefined }[];
    api_key: string | null;
    request_id?: string;
    thinking_level?: 'off' | 'low' | 'medium' | 'high';
    max_tokens?: number | undefined;
    attachments?: { name: string; type: string; data_base64: string }[];
    session_id?: string;
}

/**
 * Standardized response envelope for backend service operations.
 */
export interface IChatResponse {
    ok: boolean;
    reply?: { text: string; role: string };
    error?: string;
    model?: string;
    thought_signature?: string;
}

/**
 * Structured response from AIBridge operations.
 */
export interface IBridgeResponse {
    ok: boolean;
    text?: string;
    error?: string;
    images?: string[];
    thought_signature?: string;
    model?: string;
}

export interface IImageGenerationRequest {
    provider: string;
    prompt: string;
    model: string;
    session_id?: string;
    settings_key?: string;
    original_prompt?: string;
    steps?: number | null;
    cfg_scale?: number | null;
    width?: number | null;
    height?: number | null;
    /** Sampler algorithm */
    sampler?: string | null;
    /** Random seed */
    seed?: number | null;
    /** Clip skip */
    clip_skip?: number | null;
    /** Optional negative prompt */
    negative_prompt?: string | null;
    /** Number of images to generate (batch size) */
    batch_size?: number | null;
    /** Scheduler algorithm */
    scheduler?: string | null;
}

export interface IImageGenerationResponse {
    images: string[];
    ok: boolean;
    error: string | null;
}

export interface IImageGenerationPreview {
    data_url: string;
    updated_at_ms: number;
}

// ============================================================================
// State Interrogations
// ============================================================================

/**
 * Encapsulated snapshot of the AI Bridge operational lifecycle state.
 */
export interface IAIBridgeState {
    activeProviderId: string | null;
    isRunning: boolean;
}

// ============================================================================
// Catalog Metadata Models
// ============================================================================

/**
 * Analytic heuristics for evaluating model comparative performance.
 */
export interface IAIModelStats {
    speed: number;
    logic: number;
    creative: number;
}

/**
 * Tiered pricing configuration for token-based resource distribution.
 */
export interface IAIModelPricing {
    input_per_1m?: number | null;
    output_per_1m?: number | null;
    currency?: string | null;
    notes?: string | null;
}

/**
 * Model capability flags
 */
export interface IAIModelCapabilities {
    reasoning: boolean;
    vision: boolean;
    multimodal: boolean;
    long_context: boolean;
    streaming: boolean;
    function_calling: boolean;
}

/**
 * Definitive metadata schema for individual model variants.
 */
export interface IAIModelData {
    id: string;
    name: string;
    desc: string;
    descKey?: string;

    tier?: 'strong' | 'medium' | 'weak' | null;
    modelSize?: string | null;
    releaseDate?: string | null;
    contextWindow?: number | null;
    maxOutputTokens?: number | null;
    deprecated?: boolean | null;

    pricing?: IAIModelPricing | null;
    capabilities?: IAIModelCapabilities | null;
    stats?: IAIModelStats;
    apiModels?: {
        text?: string | null;
        image?: string | null;
    };
}

/**
 * Service provider configuration encompassing multiple model variants.
 */
export interface IAIProviderData {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    type: 'api' | 'local';
    baseUrl?: string;
    stats?: IAIModelStats;
    models: IAIModelData[];
}

// ============================================================================
// Registry Integrations
// ============================================================================

/**
 * Application record signature for AI providers within the global catalog.
 */
export interface IAICatalogApp {
    id: string;
    name?: string;
    type?: 'api' | 'local';
    apiProviderData?: IAIProviderData;
}

/**
 * Global application data catalog structure.
 */
export interface IAppDataCatalog {
    ai?: IAICatalogApp[];
    services?: unknown[];
    stars?: string[];
}
