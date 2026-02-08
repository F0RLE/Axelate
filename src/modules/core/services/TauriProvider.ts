import { listen } from '@tauri-apps/api/event';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type * as Bindings from '../types/bindings';
import { logger } from './LoggerService';
import type { TGlobalWin } from '../types/global_bridge_types';

// No local types needed, using global.d.ts

export class TauriProvider {
    constructor() {
        if (this.isTauri()) {
            logger.info('[TauriProvider] Connected');
        }
    }

    public isTauri(): boolean {
        // Dynamic check to handle injection timing
        const win = globalThis as unknown as TGlobalWin;
        return '__TAURI_INTERNALS__' in win || '__TAURI__' in win;
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
        const win = globalThis as unknown as TGlobalWin;
        const tauri = win.__TAURI__;
        const globalInvoke = tauri.core.invoke;

        if (typeof globalInvoke === 'function') {
            return await (globalInvoke as (cmd: string, args: unknown) => Promise<T>)(cmd, args);
        }

        throw new Error('No valid invoke function available in this environment');
    }

    /**
     * Standardized error handling for IPC failures.
     */
    private _handleInvokeError<T>(cmd: string, args: unknown, e: unknown): Promise<T> {
        // Propagate critical errors in tests or specific commands
        if (cmd === 'set_focus' || this._isTest()) {
            return Promise.reject(e instanceof Error ? e : new Error(String(e)));
        }

        logger.warn(`[TauriProvider] IPC failure for ${cmd}, falling back to mock: ${String(e)}`);
        return this._mockInvoke(cmd, args);
    }

    private _isTest(): boolean {
        const g = globalThis as Record<string, unknown>;
        return (
            import.meta.env.MODE === 'test' ||
            process.env['NODE_ENV'] === 'test' ||
            g['vi'] !== undefined ||
            g['expect'] !== undefined
        );
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    public async listen<T>(event: string, callback: (payload: T) => void): Promise<() => void> {
        if (this.isTauri()) {
            // Using imported listen for robust IPC
            const unlisten = await listen<T>(event, (e) => {
                callback(e.payload);
            });
            return unlisten;
        } else {
            logger.info(`[TauriProvider] Mock Listen: ${event}`);
            return () => {
                /* no-op */
            };
        }
    }

    public async writeToClipboard(text: string): Promise<void> {
        if (this.isTauri()) {
            await this.invoke('plugin:clipboard-manager|write_text', { text });
        } else {
            logger.info(`[Mock Clipboard] Write: ${text}`);
        }
    }

    public async openUrl(url: string): Promise<void> {
        if (this.isTauri()) {
            await this.invoke('plugin:shell|open', { path: url });
        } else {
            logger.info(`[Mock Shell] Open URL: ${url}`);
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
            logger.error(`[TauriProvider] Secure get failed for ${service}: ${String(e)}`);
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
            logger.error(`[TauriProvider] Secure save failed for ${service}: ${String(e)}`);
            throw e;
        }
    }

    private _mockInvoke<T>(cmd: string, args: unknown): Promise<T> {
        const isProd = !this._isTest() && import.meta.env.MODE === 'production';
        if (isProd) {
            logger.warn('[TauriProvider] Mock invoked in production! Sane fallback returned.');
        } else {
            logger.debug(`[Mock Invoke] ${cmd} ${JSON.stringify(args)}`);
        }

        const saneDefaults: Record<string, unknown> = {
            get_settings: {
                language: 'en',
                theme: 'dark',
                use_gpu: true,
                debug_mode: false,
            } satisfies Bindings.AppSettings,
            get_translations: {},
            get_system_language: 'en',
            get_config: {
                version: '1.0.0',
                catalog: { ai: [], services: [], stars: [] },
                apiProviders: [],
                models: { gpt: {}, gemini: {} },
            } satisfies Bindings.AppConfig,
            get_modules: [] satisfies Bindings.Module[],
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
            } satisfies Bindings.SystemStats,
            validate_api_key: true,
            save_setting: true,
        };

        return Promise.resolve((saneDefaults[cmd] ?? {}) as unknown as T);
    }
}
