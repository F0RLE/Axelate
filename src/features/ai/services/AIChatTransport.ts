import type { IChatRequest, IChatResponse, IBridgeResponse } from '../types/aiTypes';
import type { Core } from '@/app/init';
import { tracer } from '@/infrastructure/logging/LoggerService';

export interface IChatTransport {
    init(): Promise<void>;
    send(request: IChatRequest): Promise<IBridgeResponse>;
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
            const errorMsg = error instanceof Error ? error.message : 'Transport failure';
            tracer.error('[AIChatTransport] IPC error:', error);
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
            .listen<string>(eventName, (payload: string) => {
                if (isActive) listener(payload);
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
        return { ok: false, error: response.error ?? 'Unknown backend error' };
    }

    public destroy(): void {
        this._unlisteners.forEach((fn) => fn());
        this._unlisteners.length = 0;
    }
}
