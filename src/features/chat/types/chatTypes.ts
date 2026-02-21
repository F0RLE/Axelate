/**
 * @module chat/types/chatTypes
 * @description Type definitions for the Chat module
 */

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
    /** Text content of the message */
    content: string;
    /** Optional file attachments */
    attachments?: IChatAttachment[];
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
}

/**
 * Event emitted by the Web Speech API on result
 */
export interface ISpeechRecognitionEvent {
    /** Index of the result that has changed */
    resultIndex: number;
    /** All results currently recognized */
    results: SpeechRecognitionResultList;
}

/**
 * Event emitted by the Web Speech API on error
 */
export interface ISpeechRecognitionErrorEvent {
    /** The error code or message */
    error: string;
    /** Optional detailed message */
    message?: string;
}

/**
 * Interface for Web Speech API SpeechRecognition instance
 */
export interface ISpeechRecognitionInstance {
    /** Language code (e.g. 'en-US') */
    lang: string;
    /** Whether to recognize continuously */
    continuous: boolean;
    /** Whether to return interim (non-final) results */
    interimResults: boolean;
    /** Callback for when recognition starts */
    onstart: (() => void) | null;
    /** Callback for recognition results */
    onresult: ((_event: ISpeechRecognitionEvent) => void) | null;
    /** Callback for when recognition errors occur */
    onerror: ((_event: ISpeechRecognitionErrorEvent) => void) | null;
    /** Callback for when recognition ends */
    onend: (() => void) | null;
    /** Start recognizing */
    start: () => void;
    /** Stop recognizing */
    stop: () => void;
}
