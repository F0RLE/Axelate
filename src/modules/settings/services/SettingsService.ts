import type { IApp } from '../../core/types/coreTypes';
import type { TGlobalWin } from '../../core/types/global_bridge_types';

import { logger } from '../../core/services/LoggerService';
import type { AppSettings } from '../../core/types/bindings';
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

    public async loadSettings(): Promise<ISettings> {
        try {
            const win = globalThis as TGlobalWin;
            const data = await win.__TAURI__.core.invoke<ISettings>('get_settings');
            this.settings = { ...this.settings, ...data };
            return this.settings;
        } catch (e) {
            logger.error('[SettingsService] Failed to load settings:', e);
            return this.settings;
        }
    }

    public set(key: string, value: SettingsValue): void {
        // Safe cast for dynamic access
        (this.settings as unknown as Record<string, SettingsValue>)[key] = String(value);
        void this.saveSetting(key, value);
    }

    public async saveSetting(key: string, value: SettingsValue): Promise<void> {
        // Update local cache immediately
        (this.settings as unknown as Record<string, SettingsValue>)[key] = String(value);

        const win = globalThis as TGlobalWin;
        await win.__TAURI__.core.invoke('save_setting', { key, value: String(value) });
    }

    public async updateSettings(updates: Partial<ISettings>): Promise<void> {
        for (const [key, value] of Object.entries(updates)) {
            if (key in updates) {
                await this.saveSetting(key, value as SettingsValue);
            }
        }
    }

    public async controlService(
        action: 'start' | 'stop' | 'restart',
        service: string,
    ): Promise<boolean> {
        try {
            const win = globalThis as TGlobalWin;
            await win.__TAURI__.core.invoke('control_service', { action, service });
            return true;
        } catch (e) {
            logger.error('[SettingsService] Control service failed:', e);
            return false;
        }
    }

    public async loadGpuInfo(): Promise<IGpuInfo> {
        try {
            const win = globalThis as TGlobalWin;
            return await win.__TAURI__.core.invoke<IGpuInfo>('get_gpu_info');
        } catch (e) {
            logger.error('[SettingsService] Failed to load GPU info:', e);
            return { detected: false };
        }
    }

    public getSettings(): ISettings {
        return this.settings;
    }

    public async getModules(): Promise<IApp[]> {
        try {
            const win = globalThis as TGlobalWin;
            return await win.__TAURI__.core.invoke<IApp[]>('get_modules');
        } catch (e) {
            logger.error('[SettingsService] Failed to get modules:', e);
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
            const win = globalThis as TGlobalWin;
            await win.__TAURI__.core.invoke('save_secure_key', {
                service: storageKey,
                key: key,
            });
        } catch (e) {
            logger.error('[SettingsService] Failed to save secure key:', e);
            // Insecure fallback removed
        }
    }

    /**
     * Get API key from secure storage.
     */
    public async getSecureKey(provider: string): Promise<string> {
        const storageKey = `${provider}_api_key`;
        try {
            const win = globalThis as TGlobalWin;
            const value = await win.__TAURI__.core.invoke<string | null>('get_secure_key', {
                service: storageKey,
            });
            return value ?? '';
        } catch (e) {
            logger.error('[SettingsService] Failed to get secure key:', e);
            return '';
        }
    }

    /**
     * Validate API Key using Backend Command.
     */
    public async validateApiKey(provider: string, key: string): Promise<boolean> {
        try {
            const win = globalThis as TGlobalWin;
            // Now using the secure Backend command
            return await win.__TAURI__.core.invoke<boolean>('validate_api_key', {
                provider,
                key,
            });
        } catch (e) {
            logger.error('[SettingsService] API Key validation failed:', e);
            return false;
        }
    }

    public async addCustomModel(provider: string, id: string, name: string): Promise<void> {
        const win = globalThis as TGlobalWin;
        try {
            await win.__TAURI__.core.invoke('add_custom_model', {
                providerId: provider,
                id: id,
                name: name,
                baseModelId: id,
            });
        } catch (e) {
            logger.error('[SettingsService] Failed to add custom model:', e);
            throw e;
        }
    }

    public async getCustomModels(): Promise<ICustomModel[]> {
        const win = globalThis as TGlobalWin;
        if ((win as unknown as Record<string, unknown>)['__TAURI__'] === undefined) {
            // Web fallback (aggregate all providers? or just return empty for compliance)
            // returning all local keys
            let all: ICustomModel[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key?.startsWith('custom_models_') === true) {
                    const provider = key.replace('custom_models_', '');
                    const item = localStorage.getItem(key);
                    const models = JSON.parse(item ?? '[]') as ICustomModel[];
                    all = all.concat(
                        models.map((m: ICustomModel) => ({ ...m, provider_id: provider })),
                    );
                }
            }
            return all;
        } else {
            try {
                return await win.__TAURI__.core.invoke<ICustomModel[]>('get_custom_models');
            } catch (e) {
                logger.error('[SettingsService] Failed to get custom models:', e);
                return [];
            }
        }
    }
}
