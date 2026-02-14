import type { Core } from '@/app/init';
import { logger } from '@/infrastructure/logging/LoggerService';
import type { StateService } from '@/shared/services/StateService';
import { getMostPowerfulModel } from '../utils/catalogHelpers';

export class AIProviderManager {
    private _core: Core | null = null;
    private _activeProviderId: string | null = null;
    private _apiKey: string | null = null;
    private _model = '';
    
    // Session Management
    private _sessionId: string = 'default';

    public setCore(core: Core): void {
        this._core = core;
    }

    public async init(): Promise<void> {
        // Initialize Session ID using Secure Storage
        let sid = await this._getSecureVal('ai_session_id');
        if (!sid) {
            sid = crypto.randomUUID();
            await this._saveSecureVal('ai_session_id', sid);
        }
        
        this._sessionId = sid;

        // Sync UI state
        if (this._core) {
            (this._core.state as unknown as StateService).set('ai_session_id', sid);
        }
    }

    public async startProvider(providerId: string): Promise<boolean> {
        if (this._activeProviderId === providerId) return true;

        logger.info(`[AIProviderManager] Switching provider to: ${providerId}`);
        
        if (this._activeProviderId) {
            this.stopProvider();
        }

        try {
            const apiKey = await this._resolveApiKey(providerId);
            const isLocal = providerId === 'local' || providerId === 'axelate-localai';

            if (!apiKey && !isLocal) {
                return false;
            }

            const model = this._getPersistedModel(providerId) ?? this._getDefaultModel(providerId);

            this._activeProviderId = providerId;
            this._apiKey = apiKey;
            this._model = model;

            // Persist state
            if (this._core) {
                const state = this._core.state as unknown as StateService;
                state.setSelectedAIModel(providerId, model);
                state.set('last_active_provider', providerId);
            }

            return true;
        } catch (error) {
            logger.error('[AIProviderManager] Failed to start provider:', error);
            return false;
        }
    }

    public stopProvider(): void {
        if (this._activeProviderId) {
            this._activeProviderId = null;
            this._apiKey = null;
            this._model = '';
            logger.info('[AIProviderManager] Provider stopped');
        }
    }

    public isActive(): boolean {
        if (!this._activeProviderId) return false;
        if (this._activeProviderId === 'axelate-localai') return true;
        return !!this._apiKey;
    }

    public get activeProviderId(): string | null {
        return this._activeProviderId;
    }

    public get apiKey(): string | null {
        return this._apiKey;
    }

    public get model(): string {
        return this._model;
    }

    public get sessionId(): string {
        return this._sessionId;
    }

    public getProviderDisplayName(id: string): string {
        const providers: Record<string, string> = {
            gpt: 'OpenAI GPT',
            gemini: 'Google Gemini',
            'axelate-localai': 'Axelate Local AI',
        };
        return providers[id] ?? id;
    }

    /**
     * Re-fetches the API key for the active provider safely.
     * Use this before sending messages to ensure key validity if it changed.
     */
    public async refreshActiveApiKey(): Promise<void> {
        if (this._activeProviderId) {
            const freshKey = await this._resolveApiKey(this._activeProviderId);
            if (freshKey !== this._apiKey) {
                this._apiKey = freshKey;
            }
        }
    }

    // --- Private Helpers ---

    private async _resolveApiKey(providerId: string): Promise<string> {
        const keyName = `${providerId}_api_key`;
        return (await this._getSecureVal(keyName)) ?? '';
    }

    private _getPersistedModel(providerId: string): string | null {
        if (!this._core) return null;
        return (this._core.state as unknown as StateService).getSelectedAIModel(providerId) ?? null;
    }

    private _getDefaultModel(providerId: string): string {
        const catalogModel = getMostPowerfulModel(providerId);
        if (catalogModel) return catalogModel;

        const fallbacks: Record<string, string> = {
            gpt: 'gpt-5.2',
            gemini: 'gemini-3-pro',
            local: 'llama-4-maverick',
        };
        return fallbacks[providerId] ?? '';
    }

    private async _getSecureVal(key: string): Promise<string | null> {
        if (this._core) {
            return await this._core.tauriProvider.getSecureKey(key);
        }
        return null;
    }

    private async _saveSecureVal(key: string, value: string): Promise<void> {
        if (this._core) {
            await this._core.tauriProvider.saveSecureKey(key, value);
        }
    }
}
