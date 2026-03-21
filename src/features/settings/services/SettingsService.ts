import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { IApp } from '@/shared/types/coreTypes';

import { tracer } from '@/infrastructure/logging/LoggerService';
import type { AppSettings } from '@/shared/types/bindings';
export type ISettings = AppSettings;
export type SettingsValue = string | number | boolean;

export interface IGpuInfo {
    detected: boolean;
    name?: string;
    cuda?: boolean;
    memory?: number;
}

export interface ICustomModel {
    id: string;
    name: string;
    provider_id?: string;
    base_model_id?: string;
}

export class SettingsService {
    private settings: ISettings = {} as ISettings;

    constructor(private readonly _tauri: TauriProvider) {}

    public async loadSettings(): Promise<ISettings> {
        try {
            const data = await this._tauri.invoke<ISettings>('get_settings');
            // Data is already unwrapped by TauriProvider.invoke
            this.settings = { ...this.settings, ...data };
            return this.settings;
        } catch (e) {
            tracer.error('[SettingsService] Failed to load settings:', e);
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
            await this._tauri.invoke('control_service', { action, service });
            return true;
        } catch (e) {
            tracer.error('[SettingsService] Control service failed:', e);
            return false;
        }
    }

    public async loadGpuInfo(): Promise<IGpuInfo> {
        try {
            return await this._tauri.invoke<IGpuInfo>('get_gpu_info');
        } catch (e) {
            tracer.error('[SettingsService] Failed to load GPU info:', e);
            return { detected: false };
        }
    }

    public getSettings(): ISettings {
        return this.settings;
    }

    public async getModules(): Promise<IApp[]> {
        try {
            return await this._tauri.invoke<IApp[]>('get_modules');
        } catch (e) {
            tracer.error('[SettingsService] Failed to get modules:', e);
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
            tracer.error('[SettingsService] Failed to save secure key:', e);
        }
    }

    /**
     * Get API key from secure storage.
     */
    public async getSecureKey(provider: string): Promise<string> {
        const storageKey = `${provider}_api_key`;
        try {
            const value = await this._tauri.invoke<string | null>('get_secure_key', {
                service: storageKey,
            });
            return value ?? '';
        } catch (e) {
            tracer.error('[SettingsService] Failed to get secure key:', e);
            return '';
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
            tracer.error('[SettingsService] API Key validation failed:', e);
            return false;
        }
    }

    public async addCustomModel(provider: string, id: string, name: string): Promise<void> {
        try {
            await this._tauri.invoke('add_custom_model', {
                providerId: provider,
                id: id,
                name: name,
                baseModelId: id,
            });
        } catch (e) {
            tracer.error('[SettingsService] Failed to add custom model:', e);
            throw e;
        }
    }

    public async getCustomModels(): Promise<ICustomModel[]> {
        try {
            return await this._tauri.invoke<ICustomModel[]>('get_custom_models');
        } catch (e) {
            tracer.error('[SettingsService] Failed to get custom models:', e);
            return [];
        }
    }
}
