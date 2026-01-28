/**
 * @module ai/AIBridge
 * @description Central hub for AI communication infrastructure.
 * Manages provider lifecycle, message routing, and real-time streaming orchestration.
 * Implements the Singleton pattern for unified cross-module standard access.
 *
 * @example
 * ```typescript
 * import { aiBridge } from './AIBridge';
 *
 * await aiBridge.startProvider('gemini');
 * const response = await aiBridge.sendMessage('Hello!');
 * ```
 */

import type {
    MessageSource,
    MessageHandler,
    IChatRequest,
    IChatResponse,
    IAIBridgeState,
    IChatMessage,
    ChatContentPart,
    ChatContent,
} from './types/aiTypes';
import {
    getApiModelIdWithFallback,
    mapProviderToBackend,
    getMostPowerfulModel,
} from './utils/catalogHelpers';

export type { MessageSource, MessageHandler, ChatContentPart, ChatContent } from './types/aiTypes';
export type IChunkHandler = (chunk: string) => void;

// ============================================================================
// Constants
// ============================================================================

// (Local constants removed - delegated to backend)

// ============================================================================
// Types
// ============================================================================

/**
 * Global application interface for architectural service resolution.
 */
interface IGlobalContext {
    aiBridge?: AIBridge;
    showToast?: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
    t?: (key: string, defaultVal?: string) => string;
    axelateAPI?: {
        secureStorage?: {
            get: (key: string) => Promise<string | null>;
        };
    };
    __TAURI__?: {
        core: {
            invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
        };
        event: {
            listen: <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;
        };
    };
    randomizeChatGreeting?: () => void;
}

/**
 * @class AIBridge
 * @description Controls AI provider orchestration and backend communication channels.
 */
export class AIBridge {
    private _activeProviderId: string | null = null;
    private _apiKey: string | null = null;
    private _model: string = '';
    private _initialized: boolean = false;
    private readonly _unlisteners: (() => void)[] = [];
    private readonly _listeners: Map<string, MessageHandler[]> = new Map();
    private readonly _chunkListeners: Map<string, IChunkHandler[]> = new Map();
    private _chatHistory: IChatMessage[] = [];

    /**
     * Initializes the bridge singleton and registers it within the global execution context.
     */
    constructor() {
        const globalContext = globalThis as unknown as IGlobalContext;
        globalContext.aiBridge = this;
    }

    /**
     * Configures underlying IPC channels for streaming response ingestion.
     * This method is idempotent and ensures only one set of listeners is active.
     *
     * @returns Promise resolving upon successful event subscription
     * @sideeffect Attaches IPC listeners to the Tauri host environment
     */
    public async init(): Promise<void> {
        if (this._initialized) {
            console.warn('[AIBridge] Attempted duplicate initialization; operation aborted');
            return;
        }

        try {
            const ctx = globalThis as unknown as IGlobalContext;
            if (ctx.__TAURI__?.event) {
                 const unlistenChunk = await ctx.__TAURI__.event.listen<string>('ai-chat-chunk', (event) => {
                    // Diagnostic logging for streaming validation
                    if (import.meta.env.DEV) {
                        console.debug(
                            `[AIBridge] Stream chunk received (${event.payload.length} chars)`,
                        );
                    }
                    this._broadcastChunk(event.payload);
                });
                this._unlisteners.push(unlistenChunk);
                console.log(
                    '%c AIBridge %c Streaming Active ',
                    'color: #a855f7; font-weight: bold; padding: 2px 0;',
                    'color: #f3e8ff; background: #581c87; padding: 2px 6px; border-radius: 4px; font-size: 10px;',
                );
            } else {
                 console.log(
                    '%c AIBridge %c Web Mode ',
                    'color: #64748b; font-weight: bold; padding: 2px 0;',
                    'color: #f1f5f9; background: #334155; padding: 2px 6px; border-radius: 4px; font-size: 10px;',
                );
            }

            this._initialized = true;
        } catch (error: unknown) {
            console.error('[AIBridge] Critical IPC initialization failure:', error);
            // Non-blocking error for web mode availability
        }
    }

    /**
     * Internal access to the global execution context.
     */
    private get _context(): IGlobalContext {
        return globalThis as unknown as IGlobalContext;
    }

    /**
     * Initiates a specific AI provider session.
     *
     * @param providerId - Unique provider identifier (e.g., 'gpt', 'gemini')
     * @returns Promise indicating success of the activation flow
     * @sideeffect Retrieves credentials and synchronizes model configuration
     */
    public async startProvider(providerId: string): Promise<boolean> {
        console.log(`[AIBridge] Transitions initiated for provider: ${providerId}`);

        if (this._activeProviderId && this._activeProviderId !== providerId) {
            this.stopProvider();
        }

        try {
            const apiKey = await this._getApiKey(providerId);

            if (!apiKey) {
                this._showErrorToast('ui.ai.no_api_key', 'API key configuration missing');
                return false;
            }

            const modelKey = `${providerId}_selected_model`;
            const model = localStorage.getItem(modelKey) || this._getDefaultModel(providerId);

            this._activeProviderId = providerId;
            this._apiKey = apiKey;
            this._model = model;

            // Save for persistence across restarts
            localStorage.setItem(modelKey, model);
            localStorage.setItem('last_active_provider', providerId);

            const providerName = mapProviderToBackend(providerId);

            const providerDisplay = providerId === 'gpt' ? 'OpenAI GPT' : 'Google Gemini';
            this._showSuccessToast('ui.ai.provider_started', `${providerDisplay} session active`);

            console.log(`[AIBridge] Context synchronized: ${providerName}, model: ${model}`);
            return true;
        } catch (error: unknown) {
            console.error('[AIBridge] Provider activation sequence failed:', error);
            const msg = error instanceof Error ? error.message : 'Unknown activation trap';
            this._showToast(msg, 'error');
            return false;
        }
    }

    /**
     * Resolves the API key from the designated security layer or local cache.
     */
    private async _getApiKey(providerId: string): Promise<string> {
        const keyName = `${providerId}_api_key`;

        // Prioritize Tauri secure storage for cross-module consistency
        if (this._context.__TAURI__?.core) {
            try {
                const value = await this._context.__TAURI__.core.invoke<string | null>(
                    'get_secure_key',
                    {
                        service: keyName,
                    },
                );
                if (value) return value;
            } catch (error) {
                console.warn(`[AIBridge] Secure storage retrieval failed for ${keyName}:`, error);
            }
        }

        // Fallback to localStorage (used in web-only mode)
        return localStorage.getItem(keyName) || '';
    }

    /**
     * Evaluates model hierarchies to determine the optimal default candidate.
     */
    private _getDefaultModel(providerId: string): string {
        const catalogModel = getMostPowerfulModel(providerId);
        if (catalogModel) return catalogModel;

        const staticFallbacks: Record<string, string> = {
            gpt: 'gpt-5-mini',
            gemini: 'gemini-3-flash',
            local: 'qwen3-8b',
        };
        return staticFallbacks[providerId] || '';
    }

    /**
     * Terminates the active provider session and purges volatile state buffers.
     *
     * @sideeffect Resets authentication tokens and history context
     */
    public stopProvider(): void {
        if (this._activeProviderId) {
            const providerId = this._activeProviderId;

            this._activeProviderId = null;
            this._apiKey = null;
            this._model = '';
            this._chatHistory = [];

            const providerDisplay = providerId === 'gpt' ? 'OpenAI GPT' : 'Google Gemini';
            this._showInfoToast('ui.ai.provider_stopped', `${providerDisplay} session terminated`);

            console.log('[AIBridge] Provider context purged via explicit termination');
        }
    }

    /**
     * Verifies if the service is currently prepared for message processing.
     */
    public isActive(): boolean {
        return this._activeProviderId !== null && this._apiKey !== null;
    }

    /**
     * Retrieves functional metadata for the active provider instance.
     */
    public getActiveProvider(): { id: string; name: string } | null {
        if (!this._activeProviderId) return null;
        const name = this._activeProviderId === 'gpt' ? 'OpenAI GPT' : 'Google Gemini';
        return { id: this._activeProviderId, name };
    }

    /**
     * Routes a user prompt to the active provider and aggregates the resulting response.
     *
     * @param text - User input content
     * @param source - Source module identifier for message routing
     * @param attachments - Multimodal data payloads
     * @returns The final response payload from the AI engine
     * @sideeffect Mutates conversation history and broadcasts streaming segments
     */
    public async sendMessage(
        text: string,
        source: MessageSource = 'chat',
        attachments: { name: string; type: string; dataBase64: string }[] = [],
    ): Promise<string> {
        if (!this._activeProviderId) {
            return this._handleMissingProvider();
        }

        // Lazy key resolution ensures synchronization with external settings state
        await this._resolveEffectiveApiKey();

        // Local provider doesn't strictly require an API Key, but we check for consistency or skip?
        // _getApiKey for local returns '' from localStorage usually.
        // We might want to skip the check if provider is local?
        // But for now, let's assume it passes if it returns something or if we relax the check.
        // Actually, _getApiKey falls back to ''.
        // If apiKey is empty, _handleMissingApiKey triggers?
        // We should allow empty key for 'local'.

        if (
            !this._apiKey &&
            this._activeProviderId !== 'local' &&
            this._activeProviderId !== 'axelate-localai'
        ) {
            return this._handleMissingApiKey();
        }

        try {
            this._addMessageToHistory('user', text, attachments);

            // Per user request: Local AI logic is completely removed from backend.
            // We return a placeholder response here to satisfy the frontend call without executing logic.
            if (this._activeProviderId === 'local' || this._activeProviderId === 'axelate-localai') {
                const msg =
                    this._context.t?.('ui.ai.local_disabled', 'Local AI execution is disabled.') ||
                    'Local AI execution is disabled.';
                this._chatHistory.push({ role: 'assistant', content: msg });
                this._broadcastResponse(msg, source);
                return msg;
            }

            // Unified backend routing for cloud providers (GPT/Gemini)
            const request = this._constructChatRequest(attachments);
            const response = await this._invokeBackendOperation(request);

            return this._processBackendResponse(response, source);
        } catch (error: unknown) {
            const errorMsg =
                error instanceof Error ? error.message : 'Unknown communication failure';
            console.error('[AIBridge] Messaging pipeline failure:', error);
            return `Error: ${errorMsg}`;
        }
    }

    /**
     * Synchronizes the internal API key state with persistent storage.
     */
    private async _resolveEffectiveApiKey(): Promise<void> {
        if (this._activeProviderId) {
            const currentKey = await this._getApiKey(this._activeProviderId);
            if (currentKey !== this._apiKey) {
                this._apiKey = currentKey;
                console.log(
                    `[AIBridge] API key synchronized for provider: ${this._activeProviderId}`,
                );
            }
        }
    }

    /**
     * Handles scenarios where messaging is invoked without an authenticated key.
     */
    private _handleMissingApiKey(): string {
        const fallback =
            'API key provided for this provider is invalid or missing. Please check settings.';
        const msg = this._context.t?.('ui.ai.no_api_key', fallback) || fallback;

        // Log in bridge but provide a user-friendly response
        console.warn(`[AIBridge] Messaging aborted: ${msg} [Provider: ${this._activeProviderId}]`);

        this._broadcastResponse(`Error: ${msg}`, 'system');
        this._showErrorToast('ui.ai.no_api_key', msg);
        return `Error: ${msg}`;
    }

    /**
     * Handles requests made without an established provider context.
     */
    private _handleMissingProvider(): string {
        const fallback = 'No active AI engine found. Please initialize a module.';
        const msg = this._context.t?.('ui.ai.no_provider', fallback) || fallback;
        this._broadcastResponse(msg, 'system');
        return msg;
    }

    /**
     * Appends a message to the internal historical context for thread maintenance.
     */
    private _addMessageToHistory(
        role: 'user' | 'assistant',
        text: string,
        attachments?: { name: string; type: string; dataBase64: string }[],
    ): void {
        if (role === 'user' && attachments && attachments.length > 0) {
            const parts = this._createMultimodalContent(text, attachments);
            this._chatHistory.push({ role, content: parts });
        } else {
            this._chatHistory.push({ role, content: text });
        }
    }

    /**
     * Compiles a structured chat request object for the backend dispatcher.
     */
    private _constructChatRequest(
        attachments: { name: string; type: string; dataBase64: string }[],
    ): IChatRequest {
        const id = this._activeProviderId!;
        const apiModelId = getApiModelIdWithFallback(id, this._model);
        const thinkingLevel = localStorage.getItem(`${id}_thinking_level`) || 'high';

        return {
            provider: mapProviderToBackend(id),
            model: apiModelId,
            messages: this._chatHistory.map((message) => ({
                role: message.role,
                content: message.content,
                thought_signature: message.thought_signature,
            })),
            api_key: this._apiKey,
            thinking_level: thinkingLevel as 'low' | 'high' | 'minimal',
            attachments,
        };
    }

    /**
     * Executes an IPC command targeting the Tauri host's secure AI service.
     */
    private async _invokeBackendOperation(request: IChatRequest): Promise<IChatResponse> {
        if (!this._context.__TAURI__?.core) {
            console.warn('[AIBridge] IPC host unavailable; operation aborted');
            return {
                ok: false,
                error: 'Architectural IPC mismatch: Tauri host not detected.',
            };
        }
        return await this._context.__TAURI__.core.invoke<IChatResponse>('send_chat_message', {
            request,
        });
    }

    /**
     * Evaluates backend results and updates application state.
     */
    private _processBackendResponse(response: IChatResponse, source: MessageSource): string {
        if (typeof this._context.randomizeChatGreeting === 'function') {
            this._context.randomizeChatGreeting();
        }

        if (response.ok && response.reply) {
            const responseText = response.reply.text;
            const historyItem: IChatMessage = {
                role: 'assistant',
                content: responseText,
                thought_signature: response.thought_signature,
            };
            this._chatHistory.push(historyItem);
            this._broadcastResponse(responseText, source);
            return responseText;
        }

        const errorMsg = response.error || 'Provider processing error';
        console.error('[AIBridge] Backend operation anomaly detected:', errorMsg);
        return `Error: ${errorMsg}`;
    }

    /**
     * Performs direct network inference for local engine integration.
     * @deprecated Backend routing is now authoritative.
     */
    // private async _executeLocalInference... REMOVED

    /**
     * Registers a listener for finalized response broadcast.
     */
    public onMessage(listenerId: string, handler: MessageHandler): void {
        if (!this._listeners.has(listenerId)) {
            this._listeners.set(listenerId, []);
        }
        this._listeners.get(listenerId)!.push(handler);
    }

    /**
     * Revokes a registered response listener.
     */
    public removeListener(listenerId: string): void {
        this._listeners.delete(listenerId);
    }

    /**
     * Registers a listener for real-time streaming segments.
     */
    public onChunk(listenerId: string, handler: IChunkHandler): void {
        if (!this._chunkListeners.has(listenerId)) {
            this._chunkListeners.set(listenerId, []);
        }
        this._chunkListeners.get(listenerId)!.push(handler);
    }

    /**
     * Revokes a registered streaming listener.
     */
    public removeChunkListener(listenerId: string): void {
        this._chunkListeners.delete(listenerId);
    }

    /**
     * Dispatches finalized content to all registered module observers.
     */
    private _broadcastResponse(response: string, source: MessageSource): void {
        this._listeners.forEach((handlers) => {
            handlers.forEach((handler) => handler(response, source));
        });
    }

    /**
     * Dispatches streaming segments to all active chunk observers.
     */
    private _broadcastChunk(chunk: string): void {
        this._chunkListeners.forEach((handlers) => {
            handlers.forEach((handler) => handler(chunk));
        });
    }

    /**
     * Flushes the conversation buffer.
     */
    public clearHistory(): void {
        this._chatHistory = [];
    }

    /**
     * Retrieves the current service operational status.
     */
    public getState(): IAIBridgeState {
        return {
            activeProviderId: this._activeProviderId,
            isRunning: this.isActive(),
        };
    }

    /**
     * Maps user input and multimodal data into structured content parts.
     */
    private _createMultimodalContent(
        text: string,
        attachments: { name: string; type: string; dataBase64: string }[],
    ): ChatContent {
        if (!attachments || attachments.length === 0) return text;

        const parts: ChatContentPart[] = [{ type: 'text', text }];
        attachments.forEach((attachment) => {
            if (attachment.type.startsWith('image/')) {
                parts.push({
                    type: 'image_url',
                    image_url: {
                        url: `data:${attachment.type};base64,${attachment.dataBase64}`,
                    },
                });
            }
        });
        return parts;
    }

    /**
     * Flattens complex content payloads into plain text for legacy compatibility.
     */
    private _normalizeContentToString(content: ChatContent): string {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content
                .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                .map((p) => p.text)
                .join('\n');
        }
        return '';
    }

    /**
     * Deactivates all IPC listeners and clears internal registries.
     * @sideeffect Detaches from the Tauri event system
     */
    public destroy(): void {
        this._unlisteners.forEach((fn) => fn());
        this._unlisteners.length = 0;
        this._listeners.clear();
        this._chunkListeners.clear();
        this._initialized = false;
        console.log('[AIBridge] Service dismantled and resources released');
    }

    // --- Toast Helper Utilities (Architectural Consistency) ---

    private _showToast(msg: string, type: 'success' | 'error' | 'info' | 'warning'): void {
        if (typeof this._context.showToast === 'function') {
            this._context.showToast(msg, type);
        }
    }

    private _showErrorToast(key: string, fallback: string): void {
        this._showToast(this._context.t?.(key, fallback) || fallback, 'error');
    }

    private _showSuccessToast(key: string, fallback: string): void {
        this._showToast(this._context.t?.(key, fallback) || fallback, 'success');
    }

    private _showInfoToast(key: string, fallback: string): void {
        this._showToast(this._context.t?.(key, fallback) || fallback, 'info');
    }
}

// Singleton instantiation
export const aiBridge = new AIBridge();

