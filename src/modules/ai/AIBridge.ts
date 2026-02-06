import type {
    MessageSource,
    MessageHandler,
    IChatRequest,
    IChatResponse,
    IChatMessage,
    ChatContentPart,
    ChatContent,
} from './types/aiTypes';
import { getApiModelId, mapProviderToBackend, getMostPowerfulModel } from './utils/catalogHelpers';
import type { Core } from '../core/core';

export type { MessageSource, MessageHandler, ChatContentPart, ChatContent } from './types/aiTypes';
export type IChunkHandler = (chunk: string) => void;

/**
 * @class AIBridge
 * @description Controls AI provider orchestration and backend communication channels.
 * Implements architectural patterns from Section 36 of Axelate Standards.
 */
export class AIBridge {
    private _core: Core | null = null;
    private _activeProviderId: string | null = null;
    private _apiKey: string | null = null;
    private _model: string = '';
    private _initialized: boolean = false;
    private readonly _unlisteners: (() => void)[] = [];
    private readonly _listeners: Map<string, MessageHandler[]> = new Map();
    private readonly _chunkListeners: Map<string, IChunkHandler[]> = new Map();

    /**
     * Set the core instance (Dependency Injection).
     * Necessary because AIBridge is imported before Core is fully defined.
     */
    public setCore(core: Core): void {
        this._core = core;
    }

    /**
     * Initializes the bridge singleton and registries.
     */
    public async init(): Promise<void> {
        if (this._initialized) {
            console.warn('[AIBridge] Attempted duplicate initialization; operation aborted');
            return;
        }

        // Initialize Session ID using Secure Storage if available (Section 61.5)
        let sid = await this._getSecureVal('ai_session_id');
        if (!sid) {
            sid = crypto.randomUUID();
            await this._saveSecureVal('ai_session_id', sid);

            // Also persist in UI state for non-hardware-bound context
            if (this._core) {
                this._core.state.set('ai_session_id', sid);
            }
        }

        try {
            if (this._core?.tauriProvider.isTauri()) {
                const unlistenChunk = await this._core.tauriProvider.listen<string>(
                    'ai-chat-chunk',
                    (payload: string) => {
                        if (import.meta.env['DEV']) {
                            console.debug(
                                `[AIBridge] Stream chunk received (${payload.length} chars)`,
                            );
                        }
                        this._broadcastChunk(payload);
                    },
                );
                this._unlisteners.push(unlistenChunk);
                console.log('[AIBridge] Streaming active (IPC)');
            } else {
                console.log('[AIBridge] Web mode active (Mocks)');
            }

            this._initialized = true;
        } catch (error: unknown) {
            console.error('[AIBridge] Critical IPC initialization failure:', error);
        }
    }

    /**
     * Initiates a specific AI provider session.
     */
    public async startProvider(providerId: string): Promise<boolean> {
        console.log(`[AIBridge] Starting provider: ${providerId}`);

        if (this._activeProviderId && this._activeProviderId !== providerId) {
            this.stopProvider();
        }

        try {
            const apiKey = await this._getApiKey(providerId);
            const isLocal = providerId === 'local' || providerId === 'axelate-localai';

            if (!apiKey && !isLocal) {
                this._showErrorToast('ui.ai.no_api_key', 'API key missing');
                return false;
            }

            const model = this._getPersistedModel(providerId) || this._getDefaultModel(providerId);

            this._activeProviderId = providerId;
            this._apiKey = apiKey || '';
            this._model = model;

            // Persistence via Core State (Standardized Storage Section 53)
            if (this._core) {
                this._core.state.setSelectedAIModel(providerId, model);
                this._core.state.set('last_active_provider', providerId);
            }

            const providerDisplay = this._getProviderDisplayName(providerId);
            this._showSuccessToast('ui.ai.provider_started', `${providerDisplay} active`);

            console.log(`[AIBridge] Synchronized: ${providerId}, model: ${model}`);
            return true;
        } catch (error: unknown) {
            console.error('[AIBridge] Provider activation failed:', error);
            const msg = error instanceof Error ? error.message : 'Activation error';
            this._showToast(msg, 'error');
            return false;
        }
    }

    private _getProviderDisplayName(id: string): string {
        const providers: Record<string, string> = {
            gpt: 'OpenAI GPT',
            gemini: 'Google Gemini',
            'axelate-localai': 'Axelate Local AI',
        };
        return providers[id] || id;
    }

    private _getPersistedModel(providerId: string): string | null {
        if (!this._core) return null;
        return this._core.state.getSelectedAIModel(providerId) || null;
    }

    /**
     * Resolves the API key from the designated security layer.
     */
    private async _getApiKey(providerId: string): Promise<string> {
        const keyName = `${providerId}_api_key`;
        return (await this._getSecureVal(keyName)) || '';
    }

    private async _getSecureVal(key: string): Promise<string | null> {
        if (this._core) {
            return await this._core.tauriProvider.getSecureKey(key);
        }
        // Fallback for extreme cases (bootstrap)
        return null;
    }

    private async _saveSecureVal(key: string, value: string): Promise<void> {
        if (this._core) {
            await this._core.tauriProvider.saveSecureKey(key, value);
        }
    }

    private _getDefaultModel(providerId: string): string {
        const catalogModel = getMostPowerfulModel(providerId);
        if (catalogModel) return catalogModel;

        const fallbacks: Record<string, string> = {
            gpt: 'gpt-4o',
            gemini: 'gemini-1.5-pro',
            local: 'llama-3',
        };
        return fallbacks[providerId] || '';
    }

    /**
     * Terminates the active provider session.
     */
    public stopProvider(): void {
        if (this._activeProviderId) {
            const providerDisplay = this._getProviderDisplayName(this._activeProviderId);
            this._showInfoToast('ui.ai.provider_stopped', `${providerDisplay} terminated`);

            this._activeProviderId = null;
            this._apiKey = null;
            this._model = '';
            this._listeners.clear();
            this._chunkListeners.clear();

            console.log('[AIBridge] Provider purged');
        }
    }

    public isActive(): boolean {
        if (!this._activeProviderId) return false;
        if (this._activeProviderId === 'axelate-localai') return true;
        return !!this._apiKey;
    }

    public getActiveProvider(): { id: string; name: string } | null {
        if (!this._activeProviderId) return null;
        return {
            id: this._activeProviderId,
            name: this._getProviderDisplayName(this._activeProviderId),
        };
    }

    public async sendMessage(
        text: string,
        source: MessageSource = 'chat',
        attachments: { name: string; type: string; data_base64: string }[] = [],
    ): Promise<string> {
        if (!this._activeProviderId) {
            return this._handleMissingProvider();
        }

        await this._resolveEffectiveApiKey();

        if (!this._apiKey && this._activeProviderId !== 'axelate-localai') {
            return this._handleMissingApiKey();
        }

        try {
            if (this._activeProviderId === 'axelate-localai') {
                const msg = globalThis['t']('ui.ai.local_disabled', 'Local AI is disabled.');
                this._broadcastResponse(msg, source);
                return msg;
            }

            const newMessage: IChatMessage = {
                role: 'user',
                content: this._createMultimodalContent(text, attachments),
            };
            const request = this._constructChatRequest(newMessage, attachments);
            const response = await this._invokeBackendOperation(request);

            return this._processBackendResponse(response, source);
        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : 'Communication failure';
            console.error('[AIBridge] Messaging pipeline error:', error);
            return `Error: ${errorMsg}`;
        }
    }

    private async _resolveEffectiveApiKey(): Promise<void> {
        if (this._activeProviderId) {
            const currentKey = await this._getApiKey(this._activeProviderId);
            if (currentKey !== this._apiKey) {
                this._apiKey = currentKey;
            }
        }
    }

    private _handleMissingApiKey(): string {
        const msg = globalThis['t']('ui.ai.no_api_key', 'API key missing');
        this._broadcastResponse(`Error: ${msg}`, 'system');
        this._showErrorToast('ui.ai.no_api_key', msg);
        return `Error: ${msg}`;
    }

    private _handleMissingProvider(): string {
        const msg = globalThis['t']('ui.ai.no_provider', 'No engine found');
        this._broadcastResponse(msg, 'system');
        return msg;
    }

    private _constructChatRequest(
        message: IChatMessage,
        attachments: { name: string; type: string; data_base64: string }[],
    ): IChatRequest {
        const id = this._activeProviderId!;
        const modelId = getApiModelId(id, this._model);

        // Get thinking level from state instead of localStorage
        let thinkingLevel = 'high';
        if (this._core) {
            const levels = this._core.state.get('ai_thinking_level') as Record<string, string>;
            thinkingLevel = levels[id] || 'high';
        }

        const sid = this._core?.state.get('ai_session_id') || 'default';

        return {
            provider: mapProviderToBackend(id),
            model: modelId,
            messages: [
                {
                    role: message.role,
                    content: message.content,
                    thought_signature: message.thought_signature,
                },
            ],
            session_id: sid,
            api_key: this._apiKey,
            thinking_level: thinkingLevel as 'low' | 'high' | 'minimal',
            attachments,
        };
    }

    private async _invokeBackendOperation(request: IChatRequest): Promise<IChatResponse> {
        if (!this._core?.tauriProvider.isTauri()) {
            return { ok: false, error: 'IPC host unavailable' };
        }

        const timeoutPromise = new Promise<IChatResponse>((_, reject) => {
            setTimeout(() => reject(new Error('AI request timed out')), 90000);
        });

        const invokePromise = this._core.tauriProvider.invoke<IChatResponse>('send_chat_message', {
            request,
        });

        return await Promise.race([invokePromise, timeoutPromise]);
    }

    private _processBackendResponse(response: IChatResponse, source: MessageSource): string {
        const g = globalThis as Record<string, unknown>;
        if (typeof g['randomizeChatGreeting'] === 'function') {
            (g['randomizeChatGreeting'] as () => void)();
        }

        if (response.ok && response.reply) {
            const responseText = response.reply.text;
            this._broadcastResponse(responseText, source);
            return responseText;
        }

        const errorMsg = response.error || 'Provider processing error';
        console.error('[AIBridge] Backend operation anomaly:', errorMsg);
        return `Error: ${errorMsg}`;
    }

    public onMessage(listenerId: string, handler: MessageHandler): void {
        if (!this._listeners.has(listenerId)) {
            this._listeners.set(listenerId, []);
        }
        this._listeners.get(listenerId)!.push(handler);
    }

    public removeListener(listenerId: string): void {
        this._listeners.delete(listenerId);
    }

    public onChunk(listenerId: string, handler: IChunkHandler): void {
        if (!this._chunkListeners.has(listenerId)) {
            this._chunkListeners.set(listenerId, []);
        }
        this._chunkListeners.get(listenerId)!.push(handler);
    }

    public removeChunkListener(listenerId: string): void {
        this._chunkListeners.delete(listenerId);
    }

    private _broadcastResponse(response: string, source: MessageSource): void {
        this._listeners.forEach((handlers) => {
            handlers.forEach((handler) => handler(response, source));
        });
    }

    private _broadcastChunk(chunk: string): void {
        this._chunkListeners.forEach((handlers) => {
            handlers.forEach((handler) => handler(chunk));
        });
    }

    public async getHistory(): Promise<IChatMessage[]> {
        if (this._core?.tauriProvider.isTauri()) {
            try {
                const sid = this._core.state.get('ai_session_id') || 'default';
                return await this._core.tauriProvider.invoke('get_chat_history', {
                    session_id: sid,
                });
            } catch (e) {
                console.error('[AIBridge] Failed to load history:', e);
            }
        }
        return [];
    }

    public getState(): { activeProviderId: string | null; isRunning: boolean } {
        return {
            activeProviderId: this._activeProviderId,
            isRunning: this.isActive(),
        };
    }

    private _createMultimodalContent(
        text: string,
        attachments: { name: string; type: string; data_base64: string }[],
    ): ChatContent {
        if (!attachments || attachments.length === 0) return text;

        const parts: ChatContentPart[] = [{ type: 'text', text }];
        attachments.forEach((attachment) => {
            if (attachment.type.startsWith('image/')) {
                parts.push({
                    type: 'image_url',
                    image_url: {
                        url: `data:${attachment.type};base64,${attachment.data_base64}`,
                    },
                });
            }
        });
        return parts;
    }

    public destroy(): void {
        this._unlisteners.forEach((fn) => fn());
        this._unlisteners.length = 0;
        this._listeners.clear();
        this._chunkListeners.clear();
        this._initialized = false;
        console.log('[AIBridge] Resource released');
    }

    private _showToast(msg: string, type: 'success' | 'error' | 'info' | 'warning'): void {
        if (typeof globalThis['showToast'] === 'function') {
            globalThis['showToast'](msg, type);
        }
    }

    private _showErrorToast(key: string, fallback: string): void {
        this._showToast(globalThis['t'](key, fallback), 'error');
    }

    private _showSuccessToast(key: string, fallback: string): void {
        this._showToast(globalThis['t'](key, fallback), 'success');
    }

    private _showInfoToast(key: string, fallback: string): void {
        this._showToast(globalThis['t'](key, fallback), 'info');
    }
}

// Singleton instantiation
export const aiBridge = new AIBridge();
globalThis['aiBridge'] = aiBridge;
