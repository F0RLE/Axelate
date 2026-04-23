import { Channel } from '@tauri-apps/api/core';
import type {
    IChatRequest,
    IChatResponse,
    IBridgeResponse,
    IImageGenerationRequest,
    IImageGenerationResponse,
} from '../types/aiTypes';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { AITransportContext } from './AIBridgeContext';

type AIChatTransportLogger = Pick<LoggerService, 'info' | 'warn' | 'error'>;

/**
 * Safely extracts a human-readable error string from any error shape.
 * Handles: Error instances, Tauri IpcError objects {message}, plain strings, null/undefined.
 */
function extractError(error: unknown): string {
    if (error === null || error === undefined) return 'Unknown error';
    if (typeof error === 'string') return error || 'Unknown error';
    if (error instanceof Error) return error.message;
    // Tauri IpcError: { message: string, code?: string }
    if (typeof error === 'object') {
        const obj = error as Record<string, unknown>;
        if (typeof obj['message'] === 'string') return obj['message'];
    }
    return JSON.stringify(error);
}

interface IStreamChunkEnvelope {
    request_id: string;
    message_id: string;
    content: string;
}

export interface IChatTransport {
    init(): Promise<void>;
    send(request: IChatRequest): Promise<IBridgeResponse>;
    generateImage(request: IImageGenerationRequest): Promise<IBridgeResponse>;
    generateImageBackground(request: IImageGenerationRequest): Promise<IBridgeResponse>;
    onStream(listener: (chunk: string) => void): () => void;
    onThought(listener: (chunk: string) => void): () => void;
    setContext(context: AITransportContext): void;
    destroy(): void;
}

/**
 * Handles IPC communication for AI chat operations.
 * Isolates transport mechanism (Tauri invoke/event) from business logic.
 */
export class AIChatTransport implements IChatTransport {
    private _context: AITransportContext | null = null;
    private readonly _unlisteners = new Set<() => void>();
    private _requestCounter = 0;
    private readonly _streamListeners = new Set<(chunk: string) => void>();
    private readonly _thoughtListeners = new Set<(chunk: string) => void>();

    public constructor(private readonly _tracer: AIChatTransportLogger) {}

    public setContext(context: AITransportContext): void {
        this._context = context;
    }

    public setCore(context: AITransportContext): void {
        this.setContext(context);
    }

    public async init(): Promise<void> {
        if (this._context?.tauriProvider.isTauri() === true) {
            // Setup global listener for streaming chunks if needed here,
            // or let the bridge handle the subscription via onStream.
            // For now, we follow the pattern that Transport manages the low-level listener.
            this._tracer.info('[AIChatTransport] Transport initialized');
        }
        await Promise.resolve();
    }

    /**
     * Sends a chat request via Tauri IPC.
     */
    public async send(request: IChatRequest): Promise<IBridgeResponse> {
        if (this._context?.tauriProvider.isTauri() !== true) {
            return { ok: false, error: 'IPC host unavailable' };
        }

        const requestId = this._generateRequestId();
        const requestWithId: IChatRequest = {
            ...request,
            request_id: requestId,
        };
        const chatChannel = new Channel<IStreamChunkEnvelope>();
        chatChannel.onmessage = (payload) => {
            this._emitListeners(this._streamListeners, payload.content);
        };

        const thoughtChannel = new Channel<IStreamChunkEnvelope>();
        thoughtChannel.onmessage = (payload) => {
            this._emitListeners(this._thoughtListeners, payload.content);
        };

        try {
            return await this._runWithTimeout(
                this._context.tauriProvider
                    .invoke<IChatResponse>('send_chat_message', {
                        request: requestWithId,
                        chatChannel,
                        thoughtChannel,
                    })
                    .then((response) => this._normalizeResponse(response)),
                90000,
                'AI request timed out',
            );
        } catch (error: unknown) {
            const errorMsg = extractError(error);
            this._tracer.error('[AIChatTransport] IPC error:', error);
            return { ok: false, error: errorMsg };
        }
    }

    /**
     * Sends an image generation request via Tauri IPC.
     */
    public async generateImage(request: IImageGenerationRequest): Promise<IBridgeResponse> {
        if (this._context?.tauriProvider.isTauri() !== true) {
            return { ok: false, error: 'IPC host unavailable' };
        }

        try {
            return await this._runWithTimeout(
                this._context.tauriProvider
                    .invoke<IImageGenerationResponse>('generate_image', { request })
                    .then((response) => {
                        if (response.ok && response.images.length > 0) {
                            return { ok: true, images: response.images };
                        }
                        return { ok: false, error: response.error ?? 'Failed to generate image' };
                    }),
                300000,
                'Image generation requested timed out',
            );
        } catch (error: unknown) {
            const errorMsg = extractError(error);
            this._tracer.error('[AIChatTransport] IPC image error:', error);
            return { ok: false, error: errorMsg };
        }
    }

    /**
     * Starts an image generation job that survives window closure.
     */
    public async generateImageBackground(
        request: IImageGenerationRequest,
    ): Promise<IBridgeResponse> {
        if (this._context?.tauriProvider.isTauri() !== true) {
            return { ok: false, error: 'IPC host unavailable' };
        }

        try {
            await this._context.tauriProvider.invoke('generate_image_background', { request });
            return { ok: true };
        } catch (error: unknown) {
            const errorMsg = extractError(error);
            this._tracer.error('[AIChatTransport] IPC background image error:', error);
            return { ok: false, error: errorMsg };
        }
    }

    /**
     * Subscribes to the AI stream events.
     * Returns an unlisten function.
     */
    public onStream(listener: (chunk: string) => void): () => void {
        return this._registerListener(this._streamListeners, listener);
    }

    public onThought(listener: (chunk: string) => void): () => void {
        return this._registerListener(this._thoughtListeners, listener);
    }

    private _registerListener(
        target: Set<(chunk: string) => void>,
        listener: (chunk: string) => void,
    ): () => void {
        if (this._context?.tauriProvider.isTauri() !== true) {
            return () => {};
        }

        const cleanup = (): void => {
            if (!this._unlisteners.has(cleanup)) {
                return;
            }
            target.delete(listener);
            this._unlisteners.delete(cleanup);
        };

        target.add(listener);
        this._unlisteners.add(cleanup);
        return cleanup;
    }

    private async _runWithTimeout<T>(
        operation: Promise<T>,
        timeoutMs: number,
        timeoutMessage: string,
    ): Promise<T> {
        let timeoutId!: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(timeoutMessage));
            }, timeoutMs);
        });

        try {
            return await Promise.race([operation, timeoutPromise]);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private _normalizeResponse(response: IChatResponse): IBridgeResponse {
        if (response.ok && response.reply) {
            const normalized: IBridgeResponse = {
                ok: true,
                text: response.reply.text,
            };
            if (response.thought_signature !== undefined) {
                normalized.thought_signature = response.thought_signature;
            }
            if (response.model !== undefined) {
                normalized.model = response.model;
            }
            return normalized;
        }
        const normalized: IBridgeResponse = {
            ok: false,
            error: extractError(response.error),
        };
        if (response.model !== undefined) {
            normalized.model = response.model;
        }
        return normalized;
    }

    private _generateRequestId(): string {
        if (typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }

        if (typeof crypto.getRandomValues === 'function') {
            const randomBuffer = new Uint32Array(2);
            crypto.getRandomValues(randomBuffer);
            const firstPart = randomBuffer[0];
            const secondPart = randomBuffer[1];
            if (firstPart !== undefined && secondPart !== undefined) {
                return `req_${firstPart.toString(36)}_${secondPart.toString(36)}`;
            }
        }

        this._requestCounter += 1;
        return `req_${Date.now().toString(36)}_${this._requestCounter.toString(36)}`;
    }

    private _emitListeners(listeners: ReadonlySet<(chunk: string) => void>, payload: string): void {
        listeners.forEach((listener) => {
            listener(payload);
        });
    }

    public destroy(): void {
        this._unlisteners.forEach((fn) => fn());
        this._unlisteners.clear();
        this._streamListeners.clear();
        this._thoughtListeners.clear();
    }
}
