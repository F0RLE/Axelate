/**
 * @module features/ai/services/EngineConfigService
 * @description Thin adapter for the Tauri engine config commands.
 *
 * Wraps `get_engine_config` and `set_engine_config` Tauri commands so that
 * the rest of the frontend never needs to know about the underlying IPC details.
 *
 * All methods degrade gracefully when not running inside Tauri (returns null / no-op).
 */

import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import { tracer } from '@/infrastructure/logging/LoggerService';

/** Subset of EngineConfig that the frontend can read and write. */
export interface EngineConfig {
    engine_id: string;
    gpu_layers: number;
    context_size: number;
    model_path: string | null;
    extra_args: string[];
}

export interface EngineSettingsPayload {
    config: EngineConfig;
}

export class EngineConfigService {
    constructor(private readonly _tauri: TauriProvider) {}

    /**
     * Fetches the persisted config for an engine, falling back to backend defaults
     * if no user config has been saved yet.
     */
    public async getConfig(engineId: string): Promise<EngineConfig | null> {
        if (!this._tauri.isTauri()) return null;
        try {
            return await this._tauri.invoke<EngineConfig>('get_engine_config', {
                engineId,
            });
        } catch (e) {
            tracer.error('[EngineConfigService] Failed to get engine config:', e);
            return null;
        }
    }

    /**
     * Fetches the local engine modal data in a single backend round-trip.
     */
    public async getSettingsPayload(engineId: string): Promise<EngineSettingsPayload | null> {
        if (!this._tauri.isTauri()) return null;
        try {
            return await this._tauri.invoke<EngineSettingsPayload>('get_engine_settings_payload', {
                engineId,
            });
        } catch (e) {
            tracer.error('[EngineConfigService] Failed to get engine settings payload:', e);
            return null;
        }
    }

    /**
     * Persists the user's engine configuration.
     * Fires-and-forgets the Tauri command; errors are logged but not re-thrown.
     */
    public async setConfig(config: EngineConfig): Promise<void> {
        if (!this._tauri.isTauri()) return;
        try {
            await this._tauri.invoke<void>('set_engine_config', { config });
        } catch (e) {
            tracer.error('[EngineConfigService] Failed to save engine config:', e);
        }
    }
}
