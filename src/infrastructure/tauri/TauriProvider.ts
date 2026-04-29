import { listen } from '@tauri-apps/api/event';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type * as Bindings from '@/shared/types/bindings';
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
            this._isTauriDetected = false;
            this._tracer.warn('[TauriProvider] Handshake failed, operating in Mock mode');
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
            return this._mockInvoke(cmd, args);
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
                        message = String((errorPayload as { payload: unknown }).payload);
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
     * Internal execution of Tauri IPC with multiple fallback strategies.
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
            this._tracer.info(`[TauriProvider] Mock Listen: ${event}`);
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

        this._tracer.info(`[Mock Clipboard] Write: ${text}`);
    }

    public async readClipboardText(): Promise<string | null> {
        if (!this.isTauri()) {
            return null;
        }

        return await this.invoke<string>('plugin:clipboard-manager|read_text');
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
        const clipboard = (globalThis.navigator as BrowserClipboardHost).clipboard;
        if (clipboard === undefined) {
            return false;
        }

        await clipboard.writeText(text);
        return true;
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

    private _mockInvoke<T>(cmd: string, args: unknown): Promise<T> {
        this._tracer.debug(`[Mock Invoke] ${cmd} ${JSON.stringify(args)}`);

        const saneDefaults: Record<string, unknown> = {
            get_settings: {
                language: 'en',
                theme: 'dark',
                use_gpu: true,
                debug_mode: false,
            } as Bindings.AppSettings,
            get_ui_state: {},
            get_module_settings: {},
            get_translations: {},
            get_system_language: 'en',
            get_config: {
                version: '1.0.0',
                catalog: { ai: [], services: [], stars: [] },
                apiProviders: [],
            } as Bindings.AppConfig,
            get_modules: [] satisfies Bindings.Module[],
            get_logs: [],
            get_app_bootstrap_data: null,
            get_system_stats: {
                cpu: { percent: 0, cores: 0, name: 'Mock CPU' },
                ram: { percent: 0, usedGb: 0, totalGb: 16, availableGb: 16 },
                gpu: { usage: 0, memoryUsed: 0, memoryTotal: 0, temp: 0, name: 'Mock GPU' },
                vram: { percent: 0, usedGb: 0, totalGb: 8 },
                disk: {
                    readRate: 0,
                    writeRate: 0,
                    utilization: 0,
                    totalGb: 500,
                    usedGb: 0,
                    activityPercent: 0,
                },
                network: {
                    downloadRate: 0,
                    uploadRate: 0,
                    totalReceived: 0,
                    totalSent: 0,
                    utilization: 0,
                    activityPercent: 0,
                },
                pid: 1234,
                appCpu: 0,
                appMemory: 0,
            } satisfies Bindings.SystemStats,
            validate_api_key: true,
            has_secure_key: false,
            get_secure_key_meta: { exists: false, length: 0 } satisfies SecureKeyMeta,
            clear_logs: null,
            save_ui_state: null,
            save_setting: true,
        };

        return Promise.resolve((saneDefaults[cmd] ?? {}) as unknown as T);
    }
}
