import type { SecureKeyMeta, TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { IApp } from '@/shared/types/coreTypes';

import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type {
    AgentControlState,
    AgentProfileTokenResponse,
    AgentScope,
    AppSettings,
    GpuInfo,
} from '@/shared/types/bindings';
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

function appErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    if (typeof error !== 'object' || error === null) {
        return String(error);
    }

    const record = error as Record<string, unknown>;
    if (typeof record['message'] === 'string') {
        return record['message'];
    }

    const details = record['details'];
    if (typeof details === 'object' && details !== null) {
        return appErrorMessage(details);
    }

    for (const key of [
        'Validation',
        'NotFound',
        'PermissionDenied',
        'FrontendSecretForbidden',
        'Io',
        'Serialization',
        'Config',
    ]) {
        const value = record[key];
        if (typeof value === 'string') {
            return value;
        }
    }

    for (const key of ['External', 'Internal']) {
        const value = record[key];
        if (typeof value === 'object' && value !== null) {
            const message = (value as Record<string, unknown>)['message'];
            if (typeof message === 'string') {
                return message;
            }
        }
    }

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
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

    public async getAgentControlState(): Promise<AgentControlState> {
        const result = await invokeSafe(commands.getAgentControlState());
        if (result.status === 'ok') {
            return result.data;
        }
        this._tracer.error('[SettingsService] Failed to load Agent Control state:', result.error);
        throw new Error(appErrorMessage(result.error));
    }

    public async setAgentControlEnabled(enabled: boolean): Promise<AgentControlState> {
        const result = await invokeSafe(commands.setAgentControlEnabled(enabled));
        if (result.status === 'ok') {
            return result.data;
        }
        this._tracer.error('[SettingsService] Failed to update Agent Control:', result.error);
        throw new Error(appErrorMessage(result.error));
    }

    public async createAgentProfile(
        name: string | null = null,
        scopes: AgentScope[] | null = null,
    ): Promise<AgentProfileTokenResponse> {
        const result = await invokeSafe(commands.createAgentProfile(name, scopes));
        if (result.status === 'ok') {
            return result.data;
        }
        this._tracer.error('[SettingsService] Failed to create Agent profile:', result.error);
        throw new Error(appErrorMessage(result.error));
    }

    public async rotateAgentProfile(id: string): Promise<AgentProfileTokenResponse> {
        const result = await invokeSafe(commands.rotateAgentProfile(id));
        if (result.status === 'ok') {
            return result.data;
        }
        this._tracer.error('[SettingsService] Failed to rotate Agent profile:', result.error);
        throw new Error(appErrorMessage(result.error));
    }

    public async copyAgentProfileToken(id: string): Promise<void> {
        const result = await invokeSafe(commands.copyAgentProfileToken(id));
        if (result.status === 'ok') {
            return;
        }
        this._tracer.error('[SettingsService] Failed to copy Agent profile token:', result.error);
        throw new Error(appErrorMessage(result.error));
    }

    public async deleteAgentProfile(id: string): Promise<AgentControlState> {
        const result = await invokeSafe(commands.deleteAgentProfile(id));
        if (result.status === 'ok') {
            return result.data;
        }
        this._tracer.error('[SettingsService] Failed to delete Agent profile:', result.error);
        throw new Error(appErrorMessage(result.error));
    }

    public async decideAgentApproval(id: string, approved: boolean): Promise<AgentControlState> {
        const result = await invokeSafe(commands.decideAgentApproval(id, approved));
        if (result.status === 'ok') {
            return result.data;
        }
        this._tracer.error('[SettingsService] Failed to decide Agent approval:', result.error);
        throw new Error(appErrorMessage(result.error));
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
    public async saveSecureKey(secretService: string, key: string): Promise<void> {
        try {
            await this._tauri.invoke('save_secure_key', {
                service: secretService,
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
    public async removeSecureKey(secretService: string): Promise<void> {
        try {
            if (typeof this._tauri.removeSecureKey === 'function') {
                await this._tauri.removeSecureKey(secretService);
                return;
            }

            await this._tauri.invoke('remove_secure_key', {
                service: secretService,
            });
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to remove secure key:', e);
            throw e;
        }
    }

    /**
     * Checks whether a secure API key exists without exposing the secret value.
     */
    public async hasSecureKey(secretService: string): Promise<boolean> {
        try {
            return await this._tauri.invoke<boolean>('has_secure_key', {
                service: secretService,
            });
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to check secure key presence:', e);
            return false;
        }
    }

    /**
     * Returns non-sensitive metadata for a stored key.
     */
    public async getSecureKeyMeta(secretService: string): Promise<SecureKeyMeta> {
        try {
            return await this._tauri.getSecureKeyMeta(secretService);
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to get secure key metadata:', e);
            return { exists: false, length: 0 };
        }
    }

    /**
     * Returns the decrypted secure key for explicit user reveal flows.
     */
    public async getSecureKey(secretService: string): Promise<string | null> {
        try {
            return await this._tauri.getSecureKey(secretService);
        } catch (e) {
            this._tracer.error('[SettingsService] Failed to get secure key:', e);
            return null;
        }
    }

    /**
     * Validate API Key using Backend Command.
     */
    public async validateApiKey(
        provider: string,
        key: string,
        baseUrl?: string | undefined,
    ): Promise<boolean> {
        try {
            return await this._tauri.invoke<boolean>('validate_api_key', {
                provider,
                key,
                baseUrl: baseUrl ?? null,
            });
        } catch (e) {
            this._tracer.error('[SettingsService] API Key validation failed:', e);
            return false;
        }
    }

    /**
     * Validates the stored secure API key entirely on the backend.
     */
    public async validateStoredApiKey(
        provider: string,
        baseUrl?: string | undefined,
    ): Promise<boolean> {
        try {
            return await this._tauri.invoke<boolean>('validate_stored_api_key', {
                provider,
                baseUrl: baseUrl ?? null,
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
