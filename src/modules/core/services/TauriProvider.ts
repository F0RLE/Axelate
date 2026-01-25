/**
 * @module core/services/TauriProvider
 * @description Provides access to the Tauri API or mock implementation
 */

import { ITauriInstance } from '../types/coreTypes';

interface ITauriGlobal {
    __TAURI__?: ITauriInstance;
}

export class TauriProvider {
    private readonly _tauri: ITauriInstance | undefined;

    constructor() {
        const win = globalThis as unknown as ITauriGlobal;
        this._tauri = win.__TAURI__;
        
        if (this._tauri) {
            console.log('[TauriProvider] Connected to Tauri Host');
        } else {
            console.warn('[TauriProvider] Running in Browser Mode (Mocked)');
        }
    }

    /**
     * Check if running within a Tauri environment.
     */
    public isTauri(): boolean {
        return !!this._tauri;
    }

    /**
     * Invoke a Tauri command.
     */
    public async invoke<T, A extends Record<string, unknown> = Record<string, unknown>>(cmd: string, args: A = {} as A): Promise<T> {
        if (this._tauri) {
            console.debug(`[TauriProvider] Invoking: ${cmd}`, args);
            try {
                // Support both Tauri v1 (direct invoke) and v2 (core.invoke)
                const invokeFn = this._tauri.core?.invoke || (this._tauri as unknown as { invoke: <T>(_cmd: string, _args: unknown) => Promise<T> }).invoke;

                if (!invokeFn) {
                    throw new Error('Tauri invoke function not found (checked .core.invoke and .invoke)');
                }

                // Cast args to satisfy the complex union type of Tauri invoke
                const result = await invokeFn(cmd, args);
                console.debug(`[TauriProvider] Invoke success: ${cmd}`);
                return result as T;
            } catch (e: unknown) {
                // Ignore specific harmless errors
                if (cmd === 'set_focus') throw e;

                console.error(`[TauriProvider] Invoke error: ${cmd}`, e);
                throw e;
            }
        } else {
            return this._mockInvoke(cmd, args);
        }
    }

    /**
     * Listen for a Tauri event.
     */
    public async listen<T>(event: string, callback: (_payload: T) => void): Promise<() => void> {
        if (this._tauri) {
             // Tauri v2 listen returns UnlistenFn (which is void or () => void)
             // and the callback receives Event<T> { payload: T, ... }
             return await this._tauri.event.listen<T>(event, (e) => callback(e.payload));
        } else {
             console.log(`[TauriProvider] Mock Listen: ${event}`);
             return () => {};
        }
    }

    // --- Mock Implementation ---
    private async _mockInvoke<T>(cmd: string, args: unknown): Promise<T> {
        if (!import.meta.env.DEV) {
             console.warn('[TauriProvider] Mock invoked in production! Ignoring.');
             return null as unknown as T;
        }
        console.log(`[Mock Invoke] ${cmd}`, args);

        switch (cmd) {
            case 'get_settings': return { LANGUAGE: 'en', THEME: 'dark' } as unknown as T;
            case 'get_translations': return {} as unknown as T;
            case 'get_modules': return [] as unknown as T;
            case 'get_system_stats': return {
                cpu: { percent: 15 },
                ram: { percent: 40, used_gb: 8, total_gb: 32 },
                gpu: { usage: 20 },
                disk: { utilization: 10 },
            } as unknown as T;
            case 'get_module_status': return 'stopped' as unknown as T;
            case 'control_module': return { success: true, message: 'Mock Success' } as unknown as T;
            default: return null as unknown as T;
        }
    }
}
