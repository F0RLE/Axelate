import { listen } from '@tauri-apps/api/event';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IBridge } from '@/shared/types/IBridge';

// No local types needed, using global.d.ts
export interface SecureKeyMeta {
    exists: boolean;
    length: number;
}

type TauriRuntime = {
    hasTauriGlobals: () => boolean;
    openExternal: (url: string) => void;
};

type BrowserClipboardHost = {
    clipboard?: Pick<Clipboard, 'writeText'>;
};

function createDefaultTauriRuntime(): TauriRuntime {
    return {
        hasTauriGlobals: () => {
            const runtime = globalThis as Record<string, unknown>;
            return '__TAURI_INTERNALS__' in runtime || '__TAURI__' in runtime;
        },
        openExternal: (url: string) => {
            globalThis.open(url, '_blank');
        },
    };
}

export class TauriProvider implements IBridge {
    private _isTauriDetected: boolean | null = null;
    private _clipboardReadAccessDepth = 0;

    constructor(
        private readonly _tracer: LoggerService,
        private readonly _runtime: TauriRuntime = createDefaultTauriRuntime(),
    ) {}

    public init(): void {
        void this._performHandshake();
    }

    private async _performHandshake(): Promise<void> {
        try {
            // Priority Check: Try to call a safe, neutral command
            await this._performInvoke('get_health', {});
            this._isTauriDetected = true;
            this._tracer.debug('[TauriProvider] IPC Handshake successful');
        } catch {
            this._isTauriDetected = this._runtime.hasTauriGlobals();
            this._tracer.warn(
                this._isTauriDetected
                    ? '[TauriProvider] Handshake failed, keeping Tauri IPC because runtime globals are present'
                    : '[TauriProvider] Handshake failed, Tauri runtime is unavailable',
            );
        }
    }

    public isTauri(): boolean {
        // Fallback to static check if handshake not yet complete or failed
        if (this._isTauriDetected !== null) {
            return this._isTauriDetected;
        }

        return this._runtime.hasTauriGlobals();
    }

    public hasCapability(capability: string): boolean {
        if (!this.isTauri()) {
            return false;
        }

        if (capability === 'speechRecognition') {
            return /\bWindows\b/i.test(globalThis.navigator.userAgent);
        }

        return false;
    }

    public async invoke<T, A extends Record<string, unknown> = Record<string, unknown>>(
        cmd: string,
        args: A = {} as A,
    ): Promise<T> {
        if (!this.isTauri()) {
            return Promise.reject(new Error(`Tauri IPC unavailable for command: ${cmd}`));
        }

        try {
            const rawResponse = await this._performInvoke<unknown>(cmd, args);

            // Handle Specta Result wrapper: { status: "ok", data: T } or { status: "error", error: E }
            if (this._isSpectaResult(rawResponse)) {
                if (rawResponse.status === 'ok') {
                    return rawResponse.data as T;
                } else {
                    const errorPayload = rawResponse.error;
                    let message = 'Backend error';

                    if (typeof errorPayload === 'string') {
                        message = errorPayload;
                    } else if (
                        typeof errorPayload === 'object' &&
                        errorPayload !== null &&
                        'message' in errorPayload
                    ) {
                        message = (errorPayload as { message: string }).message;
                    } else if (
                        typeof errorPayload === 'object' &&
                        errorPayload !== null &&
                        'payload' in errorPayload
                    ) {
                        // Some AppErrors might have a payload field
                        message = stringifyInvokePayload(
                            (errorPayload as { payload: unknown }).payload,
                        );
                    }

                    const err = new Error(message);
                    // Attach full error for debugging if needed
                    Object.defineProperty(err, 'raw', { value: errorPayload, enumerable: false });
                    throw err;
                }
            }

            return rawResponse as T;
        } catch (e: unknown) {
            return this._handleInvokeError<T>(cmd, args, e);
        }
    }

    /**
     * Type guard for Specta Result wrapper.
     */
    private _isSpectaResult(obj: unknown): obj is {
        status: 'ok' | 'error';
        data?: unknown;
        error?: unknown;
    } {
        if (typeof obj !== 'object' || obj === null) return false;
        const res = obj as Record<string, unknown>;
        return (
            (res['status'] === 'ok' && 'data' in res) ||
            (res['status'] === 'error' && 'error' in res)
        );
    }

    /**
     * Internal execution of Tauri IPC.
     */
    private async _performInvoke<T>(cmd: string, args: unknown): Promise<T> {
        return await tauriInvoke(cmd, args as Record<string, unknown>);
    }

    /**
     * Standardized error handling for IPC failures.
     */
    private _handleInvokeError<T>(_cmd: string, _args: unknown, e: unknown): Promise<T> {
        if (e instanceof Error) {
            return Promise.reject(e);
        }
        if (typeof e === 'object' && e !== null) {
            const obj = e as Record<string, unknown>;
            if (typeof obj['message'] === 'string') {
                const err = new Error(obj['message']);
                if (typeof obj['code'] === 'string') {
                    // Use a safer cast to avoid typescript any issues but still attach code
                    Object.defineProperty(err, 'code', { value: obj['code'], enumerable: true });
                }
                return Promise.reject(err);
            }
            try {
                return Promise.reject(new Error(JSON.stringify(e)));
            } catch {
                return Promise.reject(new Error('[Complex Error Object]'));
            }
        }
        return Promise.reject(new Error(String(e)));
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    public async listen<T>(event: string, callback: (payload: T) => void): Promise<() => void> {
        if (this.isTauri()) {
            // Using imported listen for robust IPC
            const unlisten = await listen<T>(event, (e: { payload: T }) => {
                callback(e.payload);
            });
            return unlisten;
        } else {
            this._tracer.info(`[TauriProvider] Listen skipped outside Tauri: ${event}`);
            return () => {
                /* no-op */
            };
        }
    }

    public async writeToClipboard(text: string): Promise<void> {
        if (this.isTauri()) {
            try {
                await this.invoke('plugin:clipboard-manager|write_text', { text });
                return;
            } catch (error) {
                if (await this._writeBrowserClipboard(text)) {
                    return;
                }
                throw error;
            }
        }

        if (await this._writeBrowserClipboard(text)) {
            return;
        }

        this._tracer.info(`[Mock Clipboard] Write requested (${String(text.length)} chars)`);
    }

    public async readClipboardText(): Promise<string | null> {
        if (!this.isTauri()) {
            return null;
        }

        if (this._clipboardReadAccessDepth <= 0) {
            this._tracer.warn('[TauriProvider] Blocked clipboard read outside approved UI flow');
            return null;
        }

        return await this.invoke<string>('plugin:clipboard-manager|read_text');
    }

    public async withClipboardReadAccess<T>(callback: () => Promise<T>): Promise<T> {
        this._clipboardReadAccessDepth += 1;
        try {
            return await callback();
        } finally {
            this._clipboardReadAccessDepth = Math.max(0, this._clipboardReadAccessDepth - 1);
        }
    }

    public async openUrl(url: string): Promise<void> {
        if (this.isTauri()) {
            await this.invoke('plugin:shell|open', { path: url });
        } else {
            this._tracer.info(`[Mock Shell] Open URL: ${url}`);
            this._runtime.openExternal(url);
        }
    }

    private async _writeBrowserClipboard(text: string): Promise<boolean> {
        const navigator = (globalThis as { navigator?: BrowserClipboardHost }).navigator;
        if (navigator === undefined) {
            return false;
        }

        const clipboard = navigator.clipboard;
        if (clipboard === undefined) {
            return false;
        }

        try {
            await clipboard.writeText(text);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Retrieve a sensitive key from hardware-bound secure storage (Section 61).
     */
    public async getSecureKey(service: string): Promise<string | null> {
        try {
            return await this.invoke<string | null>('get_secure_key', { service });
        } catch (e) {
            this._tracer.error(`[TauriProvider] Secure get failed for ${service}: ${String(e)}`);
            return null;
        }
    }

    /**
     * Save a sensitive key to hardware-bound secure storage (Section 61).
     */
    public async saveSecureKey(service: string, key: string): Promise<void> {
        try {
            await this.invoke('save_secure_key', { service, key });
        } catch (e) {
            this._tracer.error(`[TauriProvider] Secure save failed for ${service}: ${String(e)}`);
            throw e;
        }
    }

    public async removeSecureKey(service: string): Promise<void> {
        try {
            await this.invoke('remove_secure_key', { service });
        } catch (e) {
            this._tracer.error(`[TauriProvider] Secure remove failed for ${service}: ${String(e)}`);
            throw e;
        }
    }

    /**
     * Check whether a non-empty key exists in secure storage.
     */
    public async hasSecureKey(service: string): Promise<boolean> {
        try {
            return await this.invoke<boolean>('has_secure_key', { service });
        } catch (e) {
            this._tracer.error(
                `[TauriProvider] Secure presence check failed for ${service}: ${String(e)}`,
            );
            return false;
        }
    }

    public async getSecureKeyMeta(service: string): Promise<SecureKeyMeta> {
        try {
            return await this.invoke<SecureKeyMeta>('get_secure_key_meta', { service });
        } catch (e) {
            this._tracer.error(
                `[TauriProvider] Secure metadata lookup failed for ${service}: ${String(e)}`,
            );
            return { exists: false, length: 0 };
        }
    }
}

function stringifyInvokePayload(payload: unknown): string {
    if (typeof payload === 'string') {
        return payload;
    }

    try {
        return JSON.stringify(payload);
    } catch {
        return String(payload);
    }
}
