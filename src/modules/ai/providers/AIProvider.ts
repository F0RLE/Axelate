/**
 * @module ai/providers/AIProvider
 * @description Base interface for all AI providers (GPT, Gemini, etc.).
 * Defines the contract for polymorphic provider integration.
 */

import type { IChatMessage } from '../types/aiTypes';

/**
 * Configuration payload for provider initialization.
 */
export interface IAIProviderConfig {
    apiKey: string;
    model: string;
}

/**
 * @interface IAIProvider
 * @description Mandatory capabilities for any AI provider integrated into the bridge.
 */
export interface IAIProvider {
    readonly id: string;
    readonly name: string;

    /**
     * Initializes the provider with required credentials and parameters.
     * 
     * @param config - Provider-specific configuration record
     */
    initialize(config: IAIProviderConfig): Promise<void>;

    /**
     * Evaluates the validity of the configured API credentials.
     * 
     * @returns Promise resolving to boolean indicating credential health
     */
    validateKey(): Promise<boolean>;

    /**
     * Evaluates if the provider is in a ready state for message processing.
     * 
     * @returns Boolean indicating operational status
     */
    isReady(): boolean;

    /**
     * Dispatches a message and retrieves the provider's response.
     * 
     * @param text - Plain text prompt
     * @param history - Current conversation context
     * @returns Promise resolving to assistant content
     */
    sendMessage(text: string, history: IChatMessage[]): Promise<string>;

    /**
     * Retrieves the list of available models supported by this provider instance.
     * 
     * @returns Promise resolving to an array of model identifiers
     */
    getAvailableModels(): Promise<string[]>;

    /**
     * Purges local resources and deactivates background processes.
     */
    dispose(): void;
}
