import type {
    IChatMessage,
    IBridgeResponse,
    MessageHandler,
    MessageSource,
    IChunkHandler,
    IImageGenerationPreview,
} from '../types/aiTypes';
import type { IAIBridgeSendMessageOptions } from '../types/IAIBridge';
import { AIProviderManager } from './AIProviderManager';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { AIChatTransport, type IChatTransport } from './AIChatTransport';
import { AIBridgeEvents } from './AIBridgeEvents';
import { EngineStatusService } from './EngineStatusService';
import type { IAIBridge } from '../types/IAIBridge';
import { AIBridgeProviderPolicy } from './AIBridgeProviderPolicy';
import type { AIBridgeContext } from './AIBridgeContext';
import { AIBridgeRuntime } from './AIBridgeRuntime';
import { AIBridgeInactivityController } from './AIBridgeInactivityController';
import { AIBridgeMessageController } from './AIBridgeMessageController';

export type { MessageSource, MessageHandler, IChunkHandler } from '../types/aiTypes';

type AIBridgeLogger = Pick<LoggerService, 'info' | 'warn' | 'error' | 'debug'>;

/**
 * @class AIBridge
 * @description Controls AI provider orchestration and backend communication channels.
 * Implements architectural patterns from Section 36 of Axelate Standards.
 */
export class AIBridge implements IAIBridge {
    private _context: AIBridgeContext | null = null;
    private readonly _unlisteners: (() => void)[] = [];
    private readonly _localContextWindows = new Map<string, number>();
    private _initialized = false;
    private readonly INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    private readonly _events = new AIBridgeEvents();
    private readonly _transport: IChatTransport;
    private readonly _manager: AIProviderManager;
    private readonly _engineStatus: EngineStatusService;
    private readonly _providerPolicy = new AIBridgeProviderPolicy();
    private readonly _runtime: AIBridgeRuntime;
    private readonly _inactivityController: AIBridgeInactivityController;
    private readonly _messageController: AIBridgeMessageController;

    public constructor(private readonly _tracer: AIBridgeLogger) {
        this._transport = new AIChatTransport(this._tracer);
        this._manager = new AIProviderManager(this._tracer);
        this._engineStatus = new EngineStatusService(this._tracer);
        this._runtime = new AIBridgeRuntime(this._tracer);
        this._inactivityController = new AIBridgeInactivityController(
            this.INACTIVITY_TIMEOUT_MS,
            this._tracer,
            () => {
                this.stopProvider();
            },
        );
        this._messageController = new AIBridgeMessageController({
            getContext: () => this._context,
            transport: this._transport,
            manager: this._manager,
            events: this._events,
            providerPolicy: this._providerPolicy,
            tracer: this._tracer,
            translate: (key, fallback) => this._translate(key, fallback),
            showToast: (message, type) => this._showToast(message, type),
            onActivity: () => this._inactivityController.reset(),
            onLongActivityStart: () => this._inactivityController.pause(),
            onLongActivityEnd: () => this._inactivityController.resume(),
            onSuccessfulResponse: () => {
                this._context?.chatController.randomizeGreeting();
            },
        });
    }

    /**
     * Set the core instance (Dependency Injection).
     * Necessary because AIBridge is imported before Core is fully defined.
     */
    public setContext(context: AIBridgeContext): void {
        this._context = context;
        if (typeof this._transport.setContext === 'function') {
            this._transport.setContext(context);
        }
        this._manager.setContext(context);
        this._engineStatus.setContext(context);
    }

    public setCore(context: AIBridgeContext): void {
        this.setContext(context);
    }

    /**
     * Initializes the bridge singleton and registries.
     */
    public async init(): Promise<void> {
        if (this._initialized) {
            this._tracer.warn('[AIBridge] Attempted duplicate initialization; operation aborted');
            return;
        }

        if (this._context === null) {
            this._tracer.error('[AIBridge] Initialization aborted: Core dependency is missing');
            return;
        }

        const context = this._context;

        try {
            await this._transport.init();
            await this._manager.init();
            const unlisteners = await this._runtime.initializeStreaming({
                context,
                transport: this._transport,
                events: this._events,
                getActiveProviderId: () => this._manager.activeProviderId,
                broadcastChunk: (payload) => {
                    this._events.broadcastChunk(payload);
                },
                broadcastThought: (payload) => {
                    this._events.broadcastThought(payload);
                },
            });
            this._unlisteners.push(...unlisteners);

            this._initialized = true;

            // Engine status indicator (ai:engine:* events → card CSS)
            this._engineStatus.init();
        } catch (error: unknown) {
            this._tracer.error('[AIBridge] Critical IPC initialization failure:', error);
            this._cleanupTransportState();
        }
    }

    /**
     * Initiates a specific AI provider session.
     */
    public async startProvider(providerId: string): Promise<boolean> {
        this._tracer.info(`[AIBridge] Starting provider: ${providerId}`);
        const started = await this._manager.startProvider(providerId);

        if (started && this._context?.tauriProvider.isTauri() === true) {
            this._inactivityController.reset();
            await this._refreshLocalContextWindow(providerId);
        }

        if (started) {
            this._engineStatus.setEngineState(providerId, 'ready');
        }

        if (!started) {
            // Match AIProviderManager._isLocalProvider: anything not in the cloud set is local.
            const isLocal = !this._providerPolicy.isCloudProvider(providerId);
            if (!isLocal && this._manager.apiKey === null) {
                this._showErrorToast('ui.ai.no_api_key', 'API key missing');
            } else {
                this._showErrorToast(
                    'ui.ai.provider_activation_failed',
                    'Provider activation failed',
                );
            }
        }
        return started;
    }

    /**
     * Terminates the active provider session.
     */
    public stopProvider(): void {
        this._tracer.info('[AIBridge] Explicitly stopping provider and clearing inactivity timers');
        const providerId = this._manager.activeProviderId;
        this._manager.stopProvider();
        this._inactivityController.clear();
        if (providerId !== null) {
            this._engineStatus.setEngineState(providerId, 'idle');
        }

        if (providerId !== null && !this._providerPolicy.isCloudProvider(providerId)) {
            this._runtime.stopProviderEngine(this._context);
        }
    }

    public async stopEngineSlot(capability: 'text' | 'image' | 'vision'): Promise<void> {
        const providerId = this._manager.activeProviderId;
        await this._runtime.stopEngineSlot(this._context, capability);
        if (this._manager.activeProviderId !== providerId) {
            return;
        }

        if (
            providerId !== null &&
            ((capability === 'image' &&
                this._providerPolicy.isManagedLocalImageEngine(providerId)) ||
                (capability === 'text' && this._providerPolicy.isLocalTextProvider(providerId)))
        ) {
            this._manager.stopProvider();
            this._engineStatus.setEngineState(providerId, 'idle');
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
        history: IChatMessage[] = [],
        options: IAIBridgeSendMessageOptions = {},
    ): Promise<IBridgeResponse> {
        return await this._messageController.sendMessage(
            text,
            source,
            attachments,
            history,
            options,
        );
    }

    public async prepareImagePrompt(text: string): Promise<IBridgeResponse> {
        return await this._messageController.prepareImagePrompt(text);
    }

    public onMessage(listenerId: string, handler: MessageHandler): void {
        this._events.onMessage(listenerId, handler);
    }

    public removeListener(listenerId: string): void {
        this._events.removeListener(listenerId);
    }

    public onChunk(listenerId: string, handler: IChunkHandler): void {
        this._events.onChunk(listenerId, handler);
    }

    public removeChunkListener(listenerId: string): void {
        this._events.removeChunkListener(listenerId);
    }

    public onReplaceChunk(listenerId: string, handler: IChunkHandler): void {
        this._events.onReplaceChunk(listenerId, handler);
    }

    public removeReplaceChunkListener(listenerId: string): void {
        this._events.removeReplaceChunkListener(listenerId);
    }

    public onThought(listenerId: string, handler: IChunkHandler): void {
        this._events.onThought(listenerId, handler);
    }

    public removeThoughtListener(listenerId: string): void {
        this._events.removeThoughtListener(listenerId);
    }

    public async getHistory(): Promise<IChatMessage[]> {
        if (this._context?.tauriProvider.isTauri() === true) {
            try {
                return await this._runtime.getHistory(this._context, this._manager.sessionId);
            } catch (e) {
                this._tracer.error('[AIBridge] Failed to load history:', e);
                throw e;
            }
        }
        return [];
    }

    public async clearHistory(): Promise<void> {
        if (this._context?.tauriProvider.isTauri() !== true) {
            return;
        }

        try {
            await this._runtime.clearHistory(this._context, this._manager.sessionId);
        } catch (e) {
            this._tracer.error('[AIBridge] Failed to clear history:', e);
            throw e;
        }
    }

    public async cancelImageGeneration(providerId?: string | null): Promise<void> {
        if (this._context?.tauriProvider.isTauri() !== true) {
            return;
        }

        const effectiveProviderId = providerId ?? this._manager.activeProviderId;
        if (
            effectiveProviderId === null ||
            !this._providerPolicy.isImageProvider(effectiveProviderId)
        ) {
            return;
        }

        await this._runtime.cancelImageGeneration(this._context, effectiveProviderId);
    }

    public async cancelTextGeneration(): Promise<boolean> {
        return await this._transport.cancelActiveChatRequest();
    }

    public async getImageGenerationPreview(): Promise<IImageGenerationPreview | null> {
        if (this._context?.tauriProvider.isTauri() !== true) {
            return null;
        }

        try {
            return await this._runtime.getImageGenerationPreview(this._context);
        } catch (error: unknown) {
            this._tracer.debug('[AIBridge] Image preview fetch skipped:', error);
            return null;
        }
    }

    public async rewindLastTurn(): Promise<string | null> {
        if (this._context?.tauriProvider.isTauri() !== true) {
            return null;
        }

        try {
            return await this._runtime.rewindLastTurn(this._context, this._manager.sessionId);
        } catch (e) {
            this._tracer.error('[AIBridge] Failed to rewind last turn:', e);
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

    public getContextWindow(): number | undefined {
        return (
            this._manager.contextWindow ??
            (this._manager.activeProviderId !== null
                ? this._localContextWindows.get(this._manager.activeProviderId)
                : undefined)
        );
    }

    public destroy(): void {
        this._manager.stopProvider();
        this._cleanupTransportState();
        this._events.clear();
        this._tracer.info('[AIBridge] Resource released');
    }

    private _showToast(msg: string, type: 'success' | 'error' | 'info' | 'warning'): void {
        this._context?.appUI.showToast(msg, type);
    }

    private async _refreshLocalContextWindow(providerId: string): Promise<void> {
        if (this._providerPolicy.isCloudProvider(providerId)) {
            return;
        }

        const context = this._context;
        if (context?.tauriProvider.isTauri() !== true) {
            return;
        }

        try {
            const config = await context.tauriProvider.invoke<{ context_size?: number }>(
                'get_engine_config',
                { engineId: providerId },
            );
            if (typeof config.context_size === 'number' && Number.isFinite(config.context_size)) {
                this._localContextWindows.set(providerId, Math.max(4096, config.context_size));
            }
        } catch (error) {
            this._tracer.debug('[AIBridge] Local context window unavailable:', error);
            this._localContextWindows.set(providerId, 4096);
        }
    }

    private _showErrorToast(key: string, fallback: string): void {
        this._showToast(this._translate(key, fallback), 'error');
    }

    protected _showInfoToast(key: string, fallback: string): void {
        this._showToast(this._translate(key, fallback), 'info');
    }

    private _cleanupTransportState(): void {
        this._unlisteners.forEach((fn) => {
            fn();
        });
        this._unlisteners.length = 0;
        this._transport.destroy();
        this._engineStatus.destroy();
        this._inactivityController.clear();
        this._initialized = false;
    }

    private _translate(key: string, fallback: string): string {
        return this._context?.i18n.t(key, fallback) ?? fallback;
    }
}
