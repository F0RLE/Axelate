import type {
    IChatMessage,
    IBridgeResponse,
    MessageHandler,
    MessageSource,
    IChunkHandler,
    IImageGenerationRequest,
} from '../types/aiTypes';
import type { Core } from '@/app/init';
import { constructChatRequest, createMultimodalContent } from '../utils/chatRequestUtils';
import { AIProviderManager } from './AIProviderManager';
import { tracer } from '@/infrastructure/logging/LoggerService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import { AIChatTransport, type IChatTransport } from './AIChatTransport';
import { engineStatusService, type EngineStatusService } from './EngineStatusService';
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
    private _inactivityTimer: number | NodeJS.Timeout | null = null;
    private readonly INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    private readonly _listeners = new Map<string, MessageHandler[]>();
    private readonly _chunkListeners = new Map<string, IChunkHandler[]>();
    private readonly _replaceChunkListeners = new Map<string, IChunkHandler[]>();
    private readonly _thoughtListeners = new Map<string, IChunkHandler[]>();
    private readonly _transport: IChatTransport = new AIChatTransport();
    private readonly _manager: AIProviderManager = new AIProviderManager();
    private readonly _engineStatus: EngineStatusService = engineStatusService;

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
        this._engineStatus.setCore(core);
    }

    /**
     * Initializes the bridge singleton and registries.
     */
    public async init(): Promise<void> {
        if (this._initialized) {
            tracer.warn('[AIBridge] Attempted duplicate initialization; operation aborted');
            return;
        }

        await this._transport.init();
        await this._manager.init();

        try {
            if (this._core?.tauriProvider.isTauri() === true) {
                const unlistenLog = await this._core.tauriProvider.listen<{
                    engine_id: string;
                    line: string;
                }>('ai:engine:log', (payload) => {
                    const line = payload.line;
                    if (this._manager.activeProviderId === payload.engine_id) {
                        // Very rough parsing for sdcpp stdout like: "step 15/20 - 2.50it/s" or "32%"
                        // Extracting standard parts to present a clean progress string:
                        const progressMatch = line.match(/(\d+\/\d+)|(\d+\.\d+it\/s)|(\d+%)/g);
                        if (progressMatch) {
                            this._broadcastReplaceChunk(
                                `🎨 Generating image... ${progressMatch.join(' - ')}\n`,
                            );
                        } else if (line.includes('generating image')) {
                            this._broadcastReplaceChunk(`🎨 Generating image...\n`);
                        }
                    }
                });
                this._unlisteners.push(unlistenLog);

                const unlistenChunk = this._transport.onStream((payload: string) => {
                    tracer.debug(
                        `[AIBridge] Stream chunk received (${String(payload.length)} chars)`,
                    );
                    this._broadcastChunk(payload);
                });
                this._unlisteners.push(unlistenChunk);

                const unlistenThought = this._transport.onThought((payload: string) => {
                    tracer.debug(
                        `[AIBridge] Thought chunk received (${String(payload.length)} chars)`,
                    );
                    this._broadcastThought(payload);
                });
                this._unlisteners.push(unlistenThought);

                tracer.info('[AIBridge] Streaming active (IPC via Transport)');
            } else {
                tracer.info('[AIBridge] Web mode active (Mocks)');
            }

            this._initialized = true;

            // Engine status indicator (ai:engine:* events → card CSS)
            this._engineStatus.init();
        } catch (error: unknown) {
            tracer.error('[AIBridge] Critical IPC initialization failure:', error);
        }
    }

    /**
     * Initiates a specific AI provider session.
     */
    public async startProvider(providerId: string): Promise<boolean> {
        tracer.info(`[AIBridge] Starting provider: ${providerId}`);
        const started = await this._manager.startProvider(providerId);

        if (started && this._core?.tauriProvider.isTauri() === true) {
            this._resetInactivityTimer();
            // Free up VRAM: Stop text if starting image, stop image if starting text
            const isImageProvider = providerId === 'sdcpp' || providerId === 'stable-diffusion';
            try {
                if (isImageProvider) {
                    await this._core.tauriProvider.invoke('stop_engine_slot', {
                        capability: 'text',
                    });
                } else {
                    await this._core.tauriProvider.invoke('stop_engine_slot', {
                        capability: 'image',
                    });
                }
            } catch (err) {
                tracer.warn(
                    `[AIBridge] Failed to stop cross-slot engine for VRAM savings: ${String(err)}`,
                );
            }
        }

        if (!started) {
            // Match AIProviderManager._isLocalProvider: anything not in the cloud set is local.
            const cloudProviders = new Set([
                'gpt',
                'gemini',
                'openai',
                'openrouter',
                'anthropic',
                'mistral',
                'claude',
                'deepseek',
            ]);
            const isLocal = !cloudProviders.has(providerId);
            if (!isLocal && this._manager.apiKey === null) {
                this._showErrorToast('ui.ai.no_api_key', 'API key missing');
            } else {
                this._showToast('Provider activation failed', 'error');
            }
        }
        return started;
    }

    /**
     * Terminates the active provider session.
     */
    public stopProvider(): void {
        tracer.info('[AIBridge] Explicitly stopping provider and clearing inactivity timers');
        this._manager.stopProvider();
        this._listeners.clear();
        this._chunkListeners.clear();
        this._replaceChunkListeners.clear();
        this._thoughtListeners.clear();
        this._clearInactivityTimer();

        // Also shut down the backend slots if we're explicitly stopped
        if (this._core?.tauriProvider.isTauri() === true) {
            void this._core.tauriProvider.invoke('stop_engine').catch((e) => {
                tracer.warn(`[AIBridge] Failed to invoke stop_engine: ${String(e)}`);
            });
        }
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

        // Local engines (llamacpp, sdcpp, etc.) don't require an API key
        if (this._manager.apiKey === null && this._manager.isActive() === false) {
            return this._handleMissingApiKey(source);
        }

        try {
            this._resetInactivityTimer();

            const providerId = this._manager.activeProviderId;
            const isImageProvider = providerId === 'sdcpp' || providerId === 'stable-diffusion';

            if (isImageProvider) {
                const settings = this._core?.settingsService.getSettings() as
                    | Record<string, unknown>
                    | undefined;

                const getNum = (key: string): number | null => {
                    const val = settings?.[key];
                    if (typeof val === 'number') return val;
                    if (typeof val === 'string') {
                        const parsed = Number(val);
                        return Number.isNaN(parsed) ? null : parsed;
                    }
                    return null;
                };

                const getStr = (key: string): string | null => {
                    const val = settings?.[key];
                    return typeof val === 'string' && val.trim() !== '' ? val : null;
                };
                const getPromptSetting = (baseKey: string, legacyCamelKey: string): string | null =>
                    getStr(baseKey) ??
                    getStr(legacyCamelKey) ??
                    getStr(baseKey.replaceAll('_', ''));

                const selectedImageModule = this._core?.stateStore.getSelectedModule('ai_image');
                const settingsKey = selectedImageModule?.id ?? providerId;
                const performanceMode = this._isImagePerformanceModeEnabled(settings, settingsKey);

                const posPrompt =
                    getPromptSetting(
                        `${settingsKey}_positive_prompt`,
                        `${settingsKey}_positivePrompt`,
                    ) ??
                    getPromptSetting(
                        `${providerId}_positive_prompt`,
                        `${providerId}_positivePrompt`,
                    );
                const baseNegPrompt =
                    getPromptSetting(
                        `${settingsKey}_negative_prompt`,
                        `${settingsKey}_negativePrompt`,
                    ) ??
                    getPromptSetting(
                        `${providerId}_negative_prompt`,
                        `${providerId}_negativePrompt`,
                    );

                // Combine user prompt with positive prompt base
                let finalPrompt = text;
                if (posPrompt !== null && posPrompt !== '') {
                    finalPrompt = `${posPrompt}, ${text}`;
                }

                const request: IImageGenerationRequest = {
                    provider: providerId,
                    prompt: finalPrompt,
                    original_prompt: text,
                    model: this._manager.model || 'default',
                    session_id: this._manager.sessionId,
                    steps: getNum(`${settingsKey}_steps`) ?? getNum(`${providerId}_steps`),
                    cfg_scale:
                        getNum(`${settingsKey}_cfg_scale`) ?? getNum(`${providerId}_cfg_scale`),
                    width: getNum(`${settingsKey}_width`) ?? getNum(`${providerId}_width`),
                    height: getNum(`${settingsKey}_height`) ?? getNum(`${providerId}_height`),
                    sampler: getStr(`${settingsKey}_sampler`) ?? getStr(`${providerId}_sampler`),
                    seed: getNum(`${settingsKey}_seed`) ?? getNum(`${providerId}_seed`),
                    batch_size:
                        getNum(`${settingsKey}_batch_size`) ?? getNum(`${providerId}_batch_size`),
                    scheduler:
                        getStr(`${settingsKey}_scheduler`) ?? getStr(`${providerId}_scheduler`),
                    clip_skip:
                        getNum(`${settingsKey}_clip_skip`) ?? getNum(`${providerId}_clip_skip`),
                    negative_prompt: baseNegPrompt,
                };
                this._broadcastReplaceChunk('🎨 Generating image...\n');

                if (performanceMode) {
                    const backgroundResponse =
                        await this._transport.generateImageBackground(request);
                    if (!backgroundResponse.ok) {
                        return this._handleTransportResponse(backgroundResponse, source);
                    }

                    this._showToast('Performance mode active', 'success');
                    await this._core?.windowService.close();
                    return { ok: true, text: '' };
                }

                const imgResponse = await this._transport.generateImage(request);
                if (imgResponse.ok && imgResponse.images && imgResponse.images.length > 0) {
                    const mdImage = `![Generated Image](${imgResponse.images[0]})`;
                    this._core?.chatController.randomizeGreeting();
                    this._broadcastResponse(mdImage, source);
                    return { ok: true, text: mdImage };
                }
                return this._handleTransportResponse(imgResponse, source);
            }

            const newMessage: IChatMessage = {
                role: 'user',
                content: createMultimodalContent(text, attachments),
            };

            // Get thinking level from state instead of localStorage
            let thinkingLevel = 'high';
            if (this._core) {
                thinkingLevel = this._core.aiSettings.getThinkingLevel(providerId);
            }

            const request = constructChatRequest(newMessage, attachments, {
                providerId,
                model: this._manager.model,
                apiKey: this._manager.apiKey,
                sessionId: this._manager.sessionId,
                thinkingLevel: thinkingLevel as 'low' | 'medium' | 'high',
                maxTokens: this._manager.maxOutputTokens,
            });
            const response = await this._transport.send(request);

            return this._handleTransportResponse(response, source);
        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : 'Communication failure';
            tracer.error('[AIBridge] Messaging pipeline error:', error);
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
        this._core?.chatController.randomizeGreeting();

        if (response.ok && typeof response.text === 'string' && response.text !== '') {
            this._broadcastResponse(response.text, source);
        } else if (!response.ok && typeof response.error === 'string' && response.error !== '') {
            tracer.error('[AIBridge] Backend operation anomaly:', response.error);
        }

        return response;
    }

    private _isImagePerformanceModeEnabled(
        settings: Record<string, unknown> | undefined,
        settingsKey: string,
    ): boolean {
        const resolve = (key: string): boolean => {
            const value = settings?.[key];
            if (typeof value === 'boolean') return value;
            if (typeof value === 'string') {
                return value.trim().toLowerCase() === 'true';
            }
            return false;
        };

        return resolve(`${settingsKey}_performance_mode`) || resolve('sdcpp_performance_mode');
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

    public onReplaceChunk(listenerId: string, handler: IChunkHandler): void {
        if (!this._replaceChunkListeners.has(listenerId)) {
            this._replaceChunkListeners.set(listenerId, []);
        }
        this._replaceChunkListeners.get(listenerId)?.push(handler);
    }

    public removeReplaceChunkListener(listenerId: string): void {
        this._replaceChunkListeners.delete(listenerId);
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

    private _broadcastReplaceChunk(chunk: string): void {
        this._replaceChunkListeners.forEach((handlers) => {
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
                        sessionId: this._manager.sessionId,
                    },
                );
            } catch (e) {
                tracer.error('[AIBridge] Failed to load history:', e);
            }
        }
        return [];
    }

    public async clearHistory(): Promise<void> {
        if (this._core?.tauriProvider.isTauri() !== true) {
            return;
        }

        try {
            await (this._core.tauriProvider as unknown as TauriProvider).invoke(
                'clear_chat_history',
                {
                    sessionId: this._manager.sessionId,
                },
            );
        } catch (e) {
            tracer.error('[AIBridge] Failed to clear history:', e);
            throw e;
        }
    }

    public getState(): { activeProviderId: string | null; isRunning: boolean } {
        return {
            activeProviderId: this._manager.activeProviderId,
            isRunning: this._manager.isActive(),
        };
    }

    public getSessionId(): string {
        return this._manager.sessionId;
    }

    public destroy(): void {
        this._manager.stopProvider();
        this._unlisteners.forEach((fn) => {
            fn();
        });
        this._unlisteners.length = 0;
        this._listeners.clear();
        this._chunkListeners.clear();
        this._replaceChunkListeners.clear();
        this._initialized = false;
        tracer.info('[AIBridge] Resource released');
    }

    private _showToast(msg: string, type: 'success' | 'error' | 'info' | 'warning'): void {
        if (typeof globalThis.showToast === 'function') {
            globalThis.showToast(msg, type);
        }
    }

    private _showErrorToast(key: string, fallback: string): void {
        this._showToast(globalThis.t(key, fallback), 'error');
    }

    protected _showInfoToast(key: string, fallback: string): void {
        this._showToast(globalThis.t(key, fallback), 'info');
    }

    // --- Inactivity Management ---

    private _clearInactivityTimer(): void {
        if (this._inactivityTimer !== null) {
            clearTimeout(this._inactivityTimer as NodeJS.Timeout);
            this._inactivityTimer = null;
        }
    }

    private _resetInactivityTimer(): void {
        this._clearInactivityTimer();
        this._inactivityTimer = setTimeout(() => {
            tracer.info(
                '[AIBridge] Engine inactivity timeout reached. Stopping provider to save memory.',
            );
            this.stopProvider();
        }, this.INACTIVITY_TIMEOUT_MS);
    }
}

// Singleton instantiation
export const aiBridge = new AIBridge();
globalThis.aiBridge = aiBridge;
