import type {
    IChatMessage,
    IBridgeResponse,
    MessageHandler,
    MessageSource,
    IChunkHandler,
} from '../types/aiTypes';
import type { Core } from '@/app/init';
import { constructChatRequest, createMultimodalContent } from '../utils/chatRequestUtils';
import type { StateService } from '@/shared/services/StateService';
import { AIProviderManager } from './AIProviderManager';
import { logger } from '@/infrastructure/logging/LoggerService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import { AIChatTransport, type IChatTransport } from './AIChatTransport';
import type { IAIBridge } from '../types/IAIBridge';

export type { MessageSource, MessageHandler, IChunkHandler } from '../types/aiTypes';

/**
 * @class AIBridge
 * @description Controls AI provider orchestration and backend communication channels.
 * Implements architectural patterns from Section 36 of Axelate Standards.
 */
export class AIBridge implements IAIBridge {
    private _core: Core | null = null;
    private readonly _unlisteners: (() => void)[] = [];
    private _initialized = false;
    private readonly _listeners = new Map<string, MessageHandler[]>();
    private readonly _chunkListeners = new Map<string, IChunkHandler[]>();
    private readonly _thoughtListeners = new Map<string, IChunkHandler[]>();
    private readonly _transport: IChatTransport = new AIChatTransport();
    private readonly _manager: AIProviderManager = new AIProviderManager();

    /**
     * Set the core instance (Dependency Injection).
     * Necessary because AIBridge is imported before Core is fully defined.
     */
    public setCore(core: Core): void {
        this._core = core;
        if (this._transport instanceof AIChatTransport) {
            this._transport.setCore(core);
        }
        this._manager.setCore(core);
    }

    /**
     * Initializes the bridge singleton and registries.
     */
    public async init(): Promise<void> {
        if (this._initialized) {
            logger.warn('[AIBridge] Attempted duplicate initialization; operation aborted');
            return;
        }

        await this._transport.init();
        await this._manager.init();

        try {
            if (this._core?.tauriProvider.isTauri() === true) {
                const unlistenChunk = this._transport.onStream((payload: string) => {
                    if (import.meta.env.DEV) {
                        logger.debug(
                            `[AIBridge] Stream chunk received (${String(payload.length)} chars)`,
                        );
                    }
                    this._broadcastChunk(payload);
                });
                this._unlisteners.push(unlistenChunk);

                const unlistenThought = this._transport.onThought((payload: string) => {
                    if (import.meta.env.DEV) {
                        logger.debug(
                            `[AIBridge] Thought chunk received (${String(payload.length)} chars)`,
                        );
                    }
                    this._broadcastThought(payload);
                });
                this._unlisteners.push(unlistenThought);

                logger.info('[AIBridge] Streaming active (IPC via Transport)');
            } else {
                logger.info('[AIBridge] Web mode active (Mocks)');
            }

            this._initialized = true;
        } catch (error: unknown) {
            logger.error('[AIBridge] Critical IPC initialization failure:', error);
        }
    }

    /**
     * Initiates a specific AI provider session.
     */
    public async startProvider(providerId: string): Promise<boolean> {
        const started = await this._manager.startProvider(providerId);

        if (started) {
            const display = this._manager.getProviderDisplayName(providerId);
            this._showSuccessToast('ui.ai.provider_started', `${display} active`);
        } else {
            // Check if it failed due to missing key
            const isLocal = providerId === 'local' || providerId === 'axelate-localai';
            if (!isLocal && this._manager.apiKey === null) {
                this._showErrorToast('ui.ai.no_api_key', 'API key missing');
            } else {
                this._showToast('Provider activation failed', 'error');
            }
        }
        return started;
    }

    /**
     * Resolves the API key from the designated security layer.
     */

    /**
     * Terminates the active provider session.
     */
    public stopProvider(): void {
        const activeName = this._manager.getProviderDisplayName(
            this._manager.activeProviderId ?? '',
        );
        this._manager.stopProvider();
        this._listeners.clear();
        this._chunkListeners.clear();
        this._thoughtListeners.clear();
        this._showInfoToast('ui.ai.provider_stopped', `${activeName} terminated`);
    }

    public isActive(): boolean {
        return this._manager.isActive();
    }

    public getActiveProvider(): { id: string; name: string } | null {
        const id = this._manager.activeProviderId;
        if (id === null) return null;
        return {
            id,
            name: this._manager.getProviderDisplayName(id),
        };
    }

    public async sendMessage(
        text: string,
        source: MessageSource = 'chat',
        attachments: { name: string; type: string; data_base64: string }[] = [],
    ): Promise<IBridgeResponse> {
        if (this._manager.activeProviderId === null) {
            return this._handleMissingProvider(source);
        }

        await this._manager.refreshActiveApiKey();

        if (this._manager.apiKey === null && this._manager.activeProviderId !== 'axelate-localai') {
            return this._handleMissingApiKey(source);
        }

        try {
            const providerId = this._manager.activeProviderId;
            // if (providerId === null) { ... } // Removed as linter says it's unnecessary

            if (providerId === 'axelate-localai') {
                const msg = globalThis.t('ui.ai.local_disabled', 'Local AI is disabled.');
                this._broadcastResponse(msg, source);
                return { ok: false, error: msg };
            }

            const newMessage: IChatMessage = {
                role: 'user',
                content: createMultimodalContent(text, attachments),
            };

            // Get thinking level from state instead of localStorage
            let thinkingLevel = 'high';
            if (this._core) {
                const levels = (this._core.state as unknown as StateService).get(
                    'ai_thinking_level',
                ) as Record<string, string>;
                thinkingLevel = levels[providerId] ?? 'high';
            }

            const request = constructChatRequest(newMessage, attachments, {
                providerId,
                model: this._manager.model,
                apiKey: this._manager.apiKey,
                sessionId: this._manager.sessionId,
                thinkingLevel: thinkingLevel as 'low' | 'high' | 'minimal',
            });
            const response = await this._transport.send(request);

            return this._handleTransportResponse(response, source);
        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : 'Communication failure';
            logger.error('[AIBridge] Messaging pipeline error:', error);
            return { ok: false, error: errorMsg };
        }
    }

    private _handleMissingApiKey(source: MessageSource): IBridgeResponse {
        const msg = globalThis.t('ui.ai.no_api_key', 'API key missing');
        this._broadcastResponse(`Error: ${msg}`, source); // Broadcasts to UI listeners if any
        this._showErrorToast('ui.ai.no_api_key', msg);
        return { ok: false, error: msg };
    }

    private _handleMissingProvider(source: MessageSource): IBridgeResponse {
        const msg = globalThis.t('ui.ai.no_provider', 'No engine found');
        this._broadcastResponse(msg, source);
        return { ok: false, error: msg };
    }

    private _handleTransportResponse(
        response: IBridgeResponse,
        source: MessageSource,
    ): IBridgeResponse {
        const g = globalThis as Record<string, unknown>;
        if (typeof g['randomizeChatGreeting'] === 'function') {
            (g['randomizeChatGreeting'] as () => void)();
        }

        if (response.ok && typeof response.text === 'string' && response.text !== '') {
            this._broadcastResponse(response.text, source);
        } else if (!response.ok && typeof response.error === 'string' && response.error !== '') {
            logger.error('[AIBridge] Backend operation anomaly:', response.error);
        }

        return response;
    }

    public onMessage(listenerId: string, handler: MessageHandler): void {
        if (!this._listeners.has(listenerId)) {
            this._listeners.set(listenerId, []);
        }
        this._listeners.get(listenerId)?.push(handler);
    }

    public removeListener(listenerId: string): void {
        this._listeners.delete(listenerId);
    }

    public onChunk(listenerId: string, handler: IChunkHandler): void {
        if (!this._chunkListeners.has(listenerId)) {
            this._chunkListeners.set(listenerId, []);
        }
        this._chunkListeners.get(listenerId)?.push(handler);
    }

    public removeChunkListener(listenerId: string): void {
        this._chunkListeners.delete(listenerId);
    }

    public onThought(listenerId: string, handler: IChunkHandler): void {
        if (!this._thoughtListeners.has(listenerId)) {
            this._thoughtListeners.set(listenerId, []);
        }
        this._thoughtListeners.get(listenerId)?.push(handler);
    }

    public removeThoughtListener(listenerId: string): void {
        this._thoughtListeners.delete(listenerId);
    }

    private _broadcastResponse(response: string, source: MessageSource): void {
        this._listeners.forEach((handlers) => {
            handlers.forEach((handler) => {
                handler(response, source);
            });
        });
    }

    private _broadcastChunk(chunk: string): void {
        this._chunkListeners.forEach((handlers) => {
            handlers.forEach((handler) => {
                handler(chunk);
            });
        });
    }

    private _broadcastThought(chunk: string): void {
        this._thoughtListeners.forEach((handlers) => {
            handlers.forEach((handler) => {
                handler(chunk);
            });
        });
    }

    public async getHistory(): Promise<IChatMessage[]> {
        if (this._core?.tauriProvider.isTauri() === true) {
            try {
                return await (this._core.tauriProvider as unknown as TauriProvider).invoke(
                    'get_chat_history',
                    {
                        session_id: this._manager.sessionId,
                    },
                );
            } catch (e) {
                logger.error('[AIBridge] Failed to load history:', e);
            }
        }
        return [];
    }

    public getState(): { activeProviderId: string | null; isRunning: boolean } {
        return {
            activeProviderId: this._manager.activeProviderId,
            isRunning: this._manager.isActive(),
        };
    }

    public destroy(): void {
        this._manager.stopProvider();
        this._unlisteners.forEach((fn) => {
            fn();
        });
        this._unlisteners.length = 0;
        this._listeners.clear();
        this._chunkListeners.clear();
        this._initialized = false;
        logger.info('[AIBridge] Resource released');
    }

    private _showToast(msg: string, type: 'success' | 'error' | 'info' | 'warning'): void {
        if (typeof globalThis.showToast === 'function') {
            globalThis.showToast(msg, type);
        }
    }

    private _showErrorToast(key: string, fallback: string): void {
        this._showToast(globalThis.t(key, fallback), 'error');
    }

    private _showSuccessToast(key: string, fallback: string): void {
        this._showToast(globalThis.t(key, fallback), 'success');
    }

    private _showInfoToast(key: string, fallback: string): void {
        this._showToast(globalThis.t(key, fallback), 'info');
    }
}

// Singleton instantiation
export const aiBridge = new AIBridge();
globalThis.aiBridge = aiBridge;
