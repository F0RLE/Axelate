/**
 * @module chat/types/chatTypes
 * @description Type definitions for the Chat module
 */

import type { ChatContent, ITokenUsage } from '@/features/ai/types/aiTypes';

/**
 * Roles for chat participants
 */
export type IChatRole = 'user' | 'assistant';

/**
 * Represents a file attached to a chat message
 */
export interface IChatAttachment {
    /** File name */
    name: string;
    /** MIME type */
    type: string;
    /** File size in bytes */
    size: number;
    /** Base64 encoded file data */
    data_base64: string;
    /** Estimated token count */
    tokens?: number;
}

/**
 * Represents a single message in a chat history
 */
export interface IChatMessage {
    /** Role of the sender */
    role: IChatRole;
    /** Message content, including multimodal payloads */
    content: ChatContent;
    /** Optional signature for reasoning-capable providers */
    thought_signature?: string;
}

/**
 * Standard response structure for chat requests
 */
export interface IChatResponse {
    /** Whether the request was successful */
    ok: boolean;
    /** Generated reply data */
    reply?: {
        /** Reply text */
        text?: string;
        /** Type indicator (e.g. 'text', 'markdown') */
        type?: string;
        /** Optional generated images */
        images?: { mime: string; data_base64: string }[];
    };
    /** Legacy or fallback message field */
    message?: string;
    /** Error message if ok is false */
    error?: string;
    /** Model identifier used for response */
    model?: string;
    /** Optional reasoning signature returned by backend */
    thought_signature?: string;
    /** Token usage calculated by backend provider */
    usage?: ITokenUsage;
}
