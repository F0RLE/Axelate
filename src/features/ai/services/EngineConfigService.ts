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
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type {
    EngineConfig as BindingEngineConfig,
    EngineSettingsPayload as BindingEngineSettingsPayload,
} from '@/shared/types/bindings';

type EngineConfigLogger = Pick<LoggerService, 'error'>;

/**
 * Backend returns a fully merged config, while Specta marks serde-defaulted fields
 * optional for request compatibility. UI code can rely on these fields after reads.
 */
export type EngineConfig = BindingEngineConfig & {
    compute_mode: NonNullable<BindingEngineConfig['compute_mode']>;
    context_size: number;
    extra_args: string[];
};

export type EngineSettingsPayload = Omit<BindingEngineSettingsPayload, 'config'> & {
    config: EngineConfig;
};

export class EngineConfigService {
    constructor(
        private readonly _tauri: TauriProvider,
        private readonly _tracer: EngineConfigLogger,
    ) {}

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
            this._tracer.error('[EngineConfigService] Failed to get engine config:', e);
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
            this._tracer.error('[EngineConfigService] Failed to get engine settings payload:', e);
            return null;
        }
    }

    /**
     * Persists the user's engine configuration.
     * Save failures are re-thrown so the settings UI can show a failed state.
     */
    public async setConfig(config: EngineConfig): Promise<void> {
        if (!this._tauri.isTauri()) return;
        try {
            await this._tauri.invoke<void>('set_engine_config', { config });
        } catch (e) {
            this._tracer.error('[EngineConfigService] Failed to save engine config:', e);
            throw e;
        }
    }
}
