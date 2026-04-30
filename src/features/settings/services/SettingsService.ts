import type { SecureKeyMeta, TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { IApp } from '@/shared/types/coreTypes';

import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { AppSettings, GpuInfo } from '@/shared/types/bindings';
import { commands } from '@/shared/types/bindings';
import { invokeSafe } from '@/shared/api/invoke';
export type ISettings = AppSettings;
export type SettingsValue = string | number | boolean;
type SettingsLogger = Pick<LoggerService, 'error'>;

export type IGpuInfo = Partial<GpuInfo> & Pick<GpuInfo, 'detected'>;

export interface ICustomModel {
    id: string;
    name: string;
    provider_id?: string;
    base_model_id?: string;
}

export class SettingsService {
    private settings: ISettings = {} as ISettings;
    private _gpuInfoPromise: Promise<IGpuInfo> | null = null;

    constructor(
        private readonly _tauri: TauriProvider,
        private readonly _tracer: SettingsLogger,
    ) {}

    public async loadSettings(): Promise<ISettings> {
        try {
            const data = await this._tauri.invoke<ISettings>('get_settings');
            // Data is already unwrapped by TauriProvider.invoke
            this.settings = { ...this.settings, ...data };
            return this.settings;
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to load settings:', e);
            return this.settings;
        }
    }

    public set(key: string, value: SettingsValue): void {
        // Safe cast for dynamic access
        (this.settings as unknown as Record<string, SettingsValue>)[key] = value;
        void this.saveSetting(key, value);
    }

    public async saveSetting(key: string, value: SettingsValue): Promise<void> {
        // Update local cache immediately
        (this.settings as unknown as Record<string, SettingsValue>)[key] = value;

        await this._tauri.invoke('save_setting', { key, value: String(value) });
    }

    public async getModuleSettings(moduleId: string): Promise<Record<string, unknown>> {
        try {
            return await this._tauri.invoke<Record<string, unknown>>('get_module_settings', {
                moduleId,
            });
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to get module settings:', e);
            return {};
        }
    }

    public async saveModuleSettings(
        moduleId: string,
        settings: Record<string, unknown>,
    ): Promise<void> {
        await this._tauri.invoke('save_module_settings', { moduleId, settings });
    }

    public async updateSettings(updates: Partial<ISettings>): Promise<void> {
        for (const [key, value] of Object.entries(updates)) {
            await this.saveSetting(key, value as SettingsValue);
        }
    }

    public async controlService(
        action: 'start' | 'stop' | 'restart',
        service: string,
    ): Promise<boolean> {
        try {
            const result = await invokeSafe(
                commands.controlModule({
                    module_id: service,
                    action,
                }),
            );
            if (result.status === 'error') {
                this._tracer.error('[SettingsService] Control service failed:', result.error);
                return false;
            }
            return result.data.success === true;
        } catch (e) {
            this._tracer.error('[SettingsService] Control service failed:', e);
            return false;
        }
    }

    public async loadGpuInfo(): Promise<IGpuInfo> {
        if (this._gpuInfoPromise !== null) {
            return await this._gpuInfoPromise;
        }

        this._gpuInfoPromise = this._tauri.invoke<IGpuInfo>('get_gpu_info').catch((e) => {
            this._tracer.error('[SettingsService] Failed to load GPU info:', e);
            this._gpuInfoPromise = null;
            return { detected: false };
        });

        return await this._gpuInfoPromise;
    }

    public getSettings(): ISettings {
        return this.settings;
    }

    public async getModules(): Promise<IApp[]> {
        try {
            return await this._tauri.invoke<IApp[]>('get_modules');
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to get modules:', e);
            return [];
        }
    }

    /**
     * Save API key securely using Tauri secure storage.
     * Fallback to localStorage is PROHIBITED for security reasons.
     */
    public async saveSecureKey(provider: string, key: string): Promise<void> {
        const storageKey = `${provider}_api_key`;
        try {
            await this._tauri.invoke('save_secure_key', {
                service: storageKey,
                key: key,
            });
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to save secure key:', e);
            throw e;
        }
    }

    /**
     * Remove a securely stored API key.
     */
    public async removeSecureKey(provider: string): Promise<void> {
        const storageKey = `${provider}_api_key`;
        try {
            if (typeof this._tauri.removeSecureKey === 'function') {
                await this._tauri.removeSecureKey(storageKey);
                return;
            }

            await this._tauri.invoke('remove_secure_key', {
                service: storageKey,
            });
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to remove secure key:', e);
            throw e;
        }
    }

    /**
     * Checks whether a secure API key exists without exposing the secret value.
     */
    public async hasSecureKey(provider: string): Promise<boolean> {
        const storageKey = `${provider}_api_key`;
        try {
            return await this._tauri.invoke<boolean>('has_secure_key', {
                service: storageKey,
            });
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to check secure key presence:', e);
            return false;
        }
    }

    /**
     * Returns non-sensitive metadata for a stored key.
     */
    public async getSecureKeyMeta(provider: string): Promise<SecureKeyMeta> {
        const storageKey = `${provider}_api_key`;
        try {
            return await this._tauri.getSecureKeyMeta(storageKey);
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to get secure key metadata:', e);
            return { exists: false, length: 0 };
        }
    }

    /**
     * Returns the decrypted secure key for explicit user reveal flows.
     */
    public async getSecureKey(provider: string): Promise<string | null> {
        const storageKey = `${provider}_api_key`;
        try {
            return await this._tauri.getSecureKey(storageKey);
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to get secure key:', e);
            return null;
        }
    }

    /**
     * Validate API Key using Backend Command.
     */
    public async validateApiKey(provider: string, key: string): Promise<boolean> {
        try {
            return await this._tauri.invoke<boolean>('validate_api_key', {
                provider,
                key,
            });
        } catch (e) {
            this._tracer.error('[SettingsService] API Key validation failed:', e);
            return false;
        }
    }

    /**
     * Validates the stored secure API key entirely on the backend.
     */
    public async validateStoredApiKey(provider: string): Promise<boolean> {
        try {
            return await this._tauri.invoke<boolean>('validate_stored_api_key', {
                provider,
            });
        } catch (e) {
            this._tracer.error('[SettingsService] Stored API key validation failed:', e);
            return false;
        }
    }

    public async addCustomModel(provider: string, id: string, name: string): Promise<void> {
        await this.addCustomModelWithBase(provider, id, name, id);
    }

    public async addCustomModelWithBase(
        provider: string,
        id: string,
        name: string,
        baseModelId: string,
    ): Promise<void> {
        try {
            await this._tauri.invoke('add_custom_model', {
                providerId: provider,
                id: id,
                name: name,
                baseModelId,
            });
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to add custom model:', e);
            throw e;
        }
    }

    public async getCustomModels(): Promise<ICustomModel[]> {
        try {
            return await this._tauri.invoke<ICustomModel[]>('get_custom_models');
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to get custom models:', e);
            return [];
        }
    }

    public async removeCustomModel(id: string): Promise<void> {
        try {
            await this._tauri.invoke('remove_custom_model', { id });
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to remove custom model:', e);
            throw e;
        }
    }
}
