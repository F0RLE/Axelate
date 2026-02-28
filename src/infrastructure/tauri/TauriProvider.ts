import { listen } from '@tauri-apps/api/event';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type * as Bindings from '@/shared/types/bindings';
import { tracer } from '@/infrastructure/logging/LoggerService';
import type { IBridge } from '@/shared/types/IBridge';
import type { TGlobalWin } from '@/shared/types/global_bridge_types';

// No local types needed, using global.d.ts

export class TauriProvider implements IBridge {
    private _isTauriDetected: boolean | null = null;

    public init(): void {
        void this._performHandshake();
    }

    private async _performHandshake(): Promise<void> {
        try {
            // Priority Check: Try to call a safe, neutral command
            await this._performInvoke('get_health', {});
            this._isTauriDetected = true;
            tracer.info('[TauriProvider] IPC Handshake successful');
        } catch {
            this._isTauriDetected = false;
            tracer.warn('[TauriProvider] Handshake failed, operating in Mock mode');
        }
    }

    public isTauri(): boolean {
        // Fallback to static check if handshake not yet complete or failed
        if (this._isTauriDetected !== null) {
            return this._isTauriDetected;
        }

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
        return await tauriInvoke(cmd, args as Record<string, unknown>);
    }

    /**
     * Standardized error handling for IPC failures.
     */
    private _handleInvokeError<T>(_cmd: string, _args: unknown, e: unknown): Promise<T> {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
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
            tracer.info(`[TauriProvider] Mock Listen: ${event}`);
            return () => {
                /* no-op */
            };
        }
    }

    public async writeToClipboard(text: string): Promise<void> {
        if (this.isTauri()) {
            await this.invoke('plugin:clipboard-manager|write_text', { text });
        } else {
            tracer.info(`[Mock Clipboard] Write: ${text}`);
        }
    }

    public async openUrl(url: string): Promise<void> {
        if (this.isTauri()) {
            await this.invoke('plugin:shell|open', { path: url });
        } else {
            tracer.info(`[Mock Shell] Open URL: ${url}`);
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
            tracer.error(`[TauriProvider] Secure get failed for ${service}: ${String(e)}`);
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
            tracer.error(`[TauriProvider] Secure save failed for ${service}: ${String(e)}`);
            throw e;
        }
    }

    private _mockInvoke<T>(cmd: string, args: unknown): Promise<T> {
        tracer.debug(`[Mock Invoke] ${cmd} ${JSON.stringify(args)}`);

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
                appCpu: 0,
                appMemory: 0,
            } satisfies Bindings.SystemStats,
            validate_api_key: true,
            save_setting: true,
        };

        return Promise.resolve((saneDefaults[cmd] ?? {}) as unknown as T);
    }
}
