import type {
    IChatRequest,
    IChatResponse,
    IBridgeResponse,
    IImageGenerationRequest,
    IImageGenerationResponse,
} from '../types/aiTypes';
import type { Core } from '@/app/init';
import { tracer } from '@/infrastructure/logging/LoggerService';

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

export interface IChatTransport {
    init(): Promise<void>;
    send(request: IChatRequest): Promise<IBridgeResponse>;
    generateImage(request: IImageGenerationRequest): Promise<IBridgeResponse>;
    generateImageBackground(request: IImageGenerationRequest): Promise<IBridgeResponse>;
    onStream(listener: (chunk: string) => void): () => void;
    onThought(listener: (chunk: string) => void): () => void;
    setCore(core: Core): void;
}

/**
 * Handles IPC communication for AI chat operations.
 * Isolates transport mechanism (Tauri invoke/event) from business logic.
 */
export class AIChatTransport implements IChatTransport {
    private _core: Core | null = null;
    private readonly _unlisteners: (() => void)[] = [];

    public setCore(core: Core): void {
        this._core = core;
    }

    public async init(): Promise<void> {
        if (this._core?.tauriProvider.isTauri() === true) {
            // Setup global listener for streaming chunks if needed here,
            // or let the bridge handle the subscription via onStream.
            // For now, we follow the pattern that Transport manages the low-level listener.
            tracer.info('[AIChatTransport] Transport initialized');
        }
        await Promise.resolve();
    }

    /**
     * Sends a chat request via Tauri IPC.
     */
    public async send(request: IChatRequest): Promise<IBridgeResponse> {
        if (this._core?.tauriProvider.isTauri() !== true) {
            return { ok: false, error: 'IPC host unavailable' };
        }

        const timeoutPromise = new Promise<IBridgeResponse>((_, reject) => {
            setTimeout(() => {
                reject(new Error('AI request timed out'));
            }, 90000);
        });

        try {
            const invokePromise = this._core.tauriProvider
                .invoke<IChatResponse>('send_chat_message', { request })
                .then((response) => this._normalizeResponse(response));

            return await Promise.race([invokePromise, timeoutPromise]);
        } catch (error: unknown) {
            const errorMsg = extractError(error);
            tracer.error('[AIChatTransport] IPC error:', error);
            return { ok: false, error: errorMsg };
        }
    }

    /**
     * Sends an image generation request via Tauri IPC.
     */
    public async generateImage(request: IImageGenerationRequest): Promise<IBridgeResponse> {
        if (this._core?.tauriProvider.isTauri() !== true) {
            return { ok: false, error: 'IPC host unavailable' };
        }

        const timeoutPromise = new Promise<IBridgeResponse>((_, reject) => {
            setTimeout(() => {
                reject(new Error('Image generation requested timed out'));
            }, 300000); // 5 mins timeout for images
        });

        try {
            const invokePromise = this._core.tauriProvider
                .invoke<IImageGenerationResponse>('generate_image', { request })
                .then((response) => {
                    if (response.ok && response.images.length > 0) {
                        return { ok: true, images: response.images };
                    }
                    return { ok: false, error: response.error ?? 'Failed to generate image' };
                });

            return await Promise.race([invokePromise, timeoutPromise]);
        } catch (error: unknown) {
            const errorMsg = extractError(error);
            tracer.error('[AIChatTransport] IPC image error:', error);
            return { ok: false, error: errorMsg };
        }
    }

    /**
     * Starts an image generation job that survives window closure.
     */
    public async generateImageBackground(
        request: IImageGenerationRequest,
    ): Promise<IBridgeResponse> {
        if (this._core?.tauriProvider.isTauri() !== true) {
            return { ok: false, error: 'IPC host unavailable' };
        }

        try {
            await this._core.tauriProvider.invoke('generate_image_background', { request });
            return { ok: true };
        } catch (error: unknown) {
            const errorMsg = extractError(error);
            tracer.error('[AIChatTransport] IPC background image error:', error);
            return { ok: false, error: errorMsg };
        }
    }

    /**
     * Subscribes to the AI stream events.
     * Returns an unlisten function.
     */
    public onStream(listener: (chunk: string) => void): () => void {
        return this._createListener('ai:chat:chunk', listener);
    }

    public onThought(listener: (chunk: string) => void): () => void {
        return this._createListener('ai:thought:chunk', listener);
    }

    private _createListener(eventName: string, listener: (chunk: string) => void): () => void {
        if (this._core?.tauriProvider.isTauri() !== true) {
            return () => {};
        }

        // In Tauri v2, listen returns a Promise<UnlistenFn>.
        // Since we need to return synchronous cleanup, we manage the promise internally.
        let unlistenFn: (() => void) | undefined;
        let isActive = true;

        void this._core.tauriProvider
            .listen<string>(eventName, (event: unknown) => {
                const chunk =
                    typeof event === 'object' && event !== null && 'payload' in event
                        ? (event as { payload: string }).payload
                        : (event as string);
                if (isActive) listener(chunk);
            })
            .then((fn) => {
                if (isActive) {
                    unlistenFn = fn;
                } else {
                    fn(); // If already cancelled, clean up immediately
                }
            });

        return () => {
            isActive = false;
            if (unlistenFn) unlistenFn();
        };
    }

    private _normalizeResponse(response: IChatResponse): IBridgeResponse {
        if (response.ok && response.reply) {
            return { ok: true, text: response.reply.text };
        }
        return { ok: false, error: extractError(response.error) };
    }

    public destroy(): void {
        this._unlisteners.forEach((fn) => fn());
        this._unlisteners.length = 0;
    }
}
