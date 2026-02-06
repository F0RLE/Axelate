import { listen } from '@tauri-apps/api/event';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

// No local types needed, using global.d.ts

export class TauriProvider {
    constructor() {
        if (this.isTauri()) {
            console.log(
                '%c TauriProvider %c Connected ',
                'color: #10b981; font-weight: bold; padding: 2px 0;',
                'color: #d1fae5; background: #064e3b; padding: 2px 6px; border-radius: 4px; font-size: 10px;',
            );
        }
    }

    public isTauri(): boolean {
        // Dynamic check to handle injection timing
        return !!globalThis['__TAURI_INTERNALS__'] || !!globalThis['__TAURI__'];
    }

    public async invoke<T, A extends Record<string, unknown> = Record<string, unknown>>(
        cmd: string,
        args: A = {} as A,
    ): Promise<T> {
        if (!this.isTauri()) {
            return this._mockInvoke(cmd, args);
        }

        try {
            return await this._performInvoke<T>(cmd, args);
        } catch (e: unknown) {
            return this._handleInvokeError<T>(cmd, args, e);
        }
    }

    /**
     * Internal execution of Tauri IPC with multiple fallback strategies.
     */
    private async _performInvoke<T>(cmd: string, args: unknown): Promise<T> {
        // Priority 1: Official v2 imported invoke
        if (typeof tauriInvoke === 'function') {
            return await tauriInvoke(cmd, args as Record<string, unknown>);
        }

        // Priority 2: Global __TAURI__ (v1 or v2 withGlobalTauri)
        const tauri = globalThis['__TAURI__'];
        const globalInvoke = tauri?.core?.invoke || tauri?.invoke;

        if (typeof globalInvoke === 'function') {
            return await globalInvoke(cmd, args as Record<string, unknown>);
        }

        throw new Error('No valid invoke function available in this environment');
    }

    /**
     * Standardized error handling for IPC failures.
     */
    private async _handleInvokeError<T>(cmd: string, args: unknown, e: unknown): Promise<T> {
        // Propagate critical errors in tests or specific commands
        if (cmd === 'set_focus' || this._isTest()) {
            throw e;
        }

        console.warn(`[TauriProvider] IPC failure for ${cmd}, falling back to mock:`, e);
        return this._mockInvoke(cmd, args);
    }

    private _isTest(): boolean {
        const g = globalThis as Record<string, unknown>;
        return (
            import.meta.env['MODE'] === 'test' ||
            process.env['NODE_ENV'] === 'test' ||
            g['vi'] !== undefined ||
            g['expect'] !== undefined
        );
    }

    public async listen<T>(event: string, callback: (_payload: T) => void): Promise<() => void> {
        if (this.isTauri()) {
            // Using imported listen for robust IPC
            const unlisten = await listen<T>(event, (e) => callback(e.payload));
            return unlisten as () => void;
        } else {
            console.log(`[TauriProvider] Mock Listen: ${event}`);
            return () => {};
        }
    }

    public async writeToClipboard(text: string): Promise<void> {
        if (this.isTauri()) {
            await this.invoke('plugin:clipboard-manager|write_text', { text });
        } else {
            console.log('[Mock Clipboard] Write:', text);
        }
    }

    public async openUrl(url: string): Promise<void> {
        if (this.isTauri()) {
            await this.invoke('plugin:shell|open', { path: url });
        } else {
            console.log('[Mock Shell] Open URL:', url);
            window.open(url, '_blank');
        }
    }

    /**
     * Retrieve a sensitive key from hardware-bound secure storage (Section 61).
     */
    public async getSecureKey(service: string): Promise<string | null> {
        try {
            return await this.invoke<string | null>('get_secure_key', { service });
        } catch (e) {
            console.error(`[TauriProvider] Secure get failed for ${service}:`, e);
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
            console.error(`[TauriProvider] Secure save failed for ${service}:`, e);
            throw e;
        }
    }

    private async _mockInvoke<T>(cmd: string, args: unknown): Promise<T> {
        const isProd = !this._isTest() && !import.meta.env.DEV;
        if (isProd) {
            console.warn('[TauriProvider] Mock invoked in production! Sane fallback returned.');
        } else {
            console.debug(`[Mock Invoke] ${cmd}`, args);
        }

        const saneDefaults: Record<string, unknown> = {
            get_settings: { LANGUAGE: 'en', THEME: 'dark' },
            get_translations: {},
            get_system_language: 'en',
            get_config: { catalog: { ai: [], services: [] }, apiProviders: [], models: {} },
            get_modules: [],
            get_app_bootstrap_data: null,
            get_system_stats: {
                cpu: { percent: 0 },
                ram: { percent: 0 },
                gpu: { usage: 0 },
                disk: { utilization: 0 },
            },
            validate_api_key: true,
            save_setting: true,
        };

        return (saneDefaults[cmd] ?? {}) as unknown as T;
    }
}
