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
    thought_signature?: string;
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
    messages: { role: string; content: ChatContent; thought_signature?: string }[];
    api_key: string | null;
    thinking_level?: 'low' | 'high' | 'minimal';
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
    tier: string;
    note?: string;
    in?: string;
    out?: string;
}

/**
 * Definitive metadata schema for individual model variants.
 */
export interface IAIModelData {
    name: string;
    desc: string;
    descKey?: string;
    pricing?: IAIModelPricing[];
    stats?: IAIModelStats;
    apiModels?: {
        text?: string;
        image?: string;
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
    models: Record<string, IAIModelData>;
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
