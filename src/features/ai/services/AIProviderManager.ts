import type { Core } from '@/app/init';
import { tracer } from '@/infrastructure/logging/LoggerService';
import { getModelData, getMostPowerfulModel } from '../utils/catalogHelpers';

export class AIProviderManager {
    private _core: Core | null = null;
    private _activeProviderId: string | null = null;
    private _hasApiKey = false;
    private _model = '';

    // Session Management
    private _sessionId: string = 'default';

    public setCore(core: Core): void {
        this._core = core;
    }

    public async init(): Promise<void> {
        // Initialize Session ID using Secure Storage
        let sid = await this._getSecureVal('ai_session_id');
        if (sid === null || sid === '') {
            sid = crypto.randomUUID();
            await this._saveSecureVal('ai_session_id', sid);
        }

        this._sessionId = sid;

        // Sync UI state
        if (this._core) {
            this._core.aiSettings.setAiSessionId(sid);
        }
    }

    public async startProvider(providerId: string): Promise<boolean> {
        if (this._activeProviderId === providerId) return true;

        tracer.info(`[AIProviderManager] Switching provider to: ${providerId}`);

        if (this._activeProviderId !== null) {
            this.stopProvider();
        }

        try {
            const isLocal = this._isLocalProvider(providerId);
            const hasApiKey = await this._resolveHasApiKey(providerId);

            if (!hasApiKey && !isLocal) {
                return false;
            }

            const model = this._resolveModel(providerId);

            this._activeProviderId = providerId;
            this._hasApiKey = isLocal || hasApiKey;
            this._model = model;

            // Persist state
            if (this._core) {
                this._core.aiSettings.setSelectedAIModel(providerId, model);
                this._core.aiSettings.setLastActiveProvider(providerId);
            }

            return true;
        } catch (error) {
            tracer.error('[AIProviderManager] Failed to start provider:', error);
            return false;
        }
    }

    public stopProvider(): void {
        if (this._activeProviderId !== null) {
            this._activeProviderId = null;
            this._hasApiKey = false;
            this._model = '';
            tracer.info('[AIProviderManager] Provider stopped');
        }
    }

    public isActive(): boolean {
        if (this._activeProviderId === null) return false;
        if (this._isLocalProvider(this._activeProviderId)) return true;
        return this._hasApiKey;
    }

    public get activeProviderId(): string | null {
        return this._activeProviderId;
    }

    public get apiKey(): string | null {
        if (this._activeProviderId === null || this._isLocalProvider(this._activeProviderId)) {
            return null;
        }
        return this._hasApiKey ? '[secure]' : null;
    }

    public get model(): string {
        return this._model;
    }

    public get sessionId(): string {
        return this._sessionId;
    }

    public get maxOutputTokens(): number | undefined {
        if (this._activeProviderId === null) return undefined;
        const modelData = getModelData(this._activeProviderId, this._model);
        return modelData?.maxOutputTokens ?? undefined;
    }

    public getProviderDisplayName(id: string): string {
        const providers: Record<string, string> = {
            gpt: 'OpenAI GPT',
            gemini: 'Google Gemini',
        };
        return providers[id] ?? id;
    }

    /**
     * Re-fetches the API key for the active provider safely.
     * Use this before sending messages to ensure key validity if it changed.
     */
    public async refreshActiveApiKey(): Promise<void> {
        if (this._activeProviderId !== null) {
            const hasApiKey = await this._resolveHasApiKey(this._activeProviderId);
            this._hasApiKey = this._isLocalProvider(this._activeProviderId) || hasApiKey;
        }
    }

    // --- Private Helpers ---

    private async _resolveHasApiKey(providerId: string): Promise<boolean> {
        if (this._isLocalProvider(providerId)) return false;

        return await this._hasSecureVal('openrouter_api_key');
    }

    /**
     * Returns true if the provider ID represents a local engine
     * (not a cloud API provider requiring an API key).
     * Any ID that doesn't match a known cloud provider prefix is treated as local.
     */
    private _isLocalProvider(providerId: string): boolean {
        const cloudProviders = new Set([
            'gpt',
            'gemini',
            'openai',
            'openrouter',
            'anthropic',
            'mistral',
            'claude',
            'deepseek',
        ]);
        return !cloudProviders.has(providerId);
    }

    private _getPersistedModel(providerId: string): string | null {
        if (!this._core) return null;
        const persistedModel = this._core.aiSettings.getSelectedAIModel(providerId);
        if (persistedModel === undefined || persistedModel === null) {
            return null;
        }

        const normalizedModel = persistedModel.trim();
        return normalizedModel === '' ? null : normalizedModel;
    }

    private _getDefaultModel(providerId: string): string {
        const catalogModel = getMostPowerfulModel(providerId);
        if (catalogModel !== null && catalogModel.trim() !== '') return catalogModel;

        const fallbacks: Record<string, string> = {
            gpt: 'gpt-5.4',
            gemini: 'gemini-3-pro',
            local: 'llama-4-maverick',
        };
        if (this._isLocalProvider(providerId)) {
            return 'default';
        }

        return fallbacks[providerId] ?? 'default';
    }

    private _resolveModel(providerId: string): string {
        return this._getPersistedModel(providerId) ?? this._getDefaultModel(providerId);
    }

    private async _getSecureVal(key: string): Promise<string | null> {
        if (this._core) {
            return await this._core.tauriProvider.getSecureKey(key);
        }
        return null;
    }

    private async _hasSecureVal(key: string): Promise<boolean> {
        if (this._core && typeof this._core.tauriProvider.hasSecureKey === 'function') {
            return Boolean(await this._core.tauriProvider.hasSecureKey(key));
        }

        const value = await this._getSecureVal(key);
        return value !== null && value.trim() !== '';
    }

    private async _saveSecureVal(key: string, value: string): Promise<void> {
        if (this._core) {
            await this._core.tauriProvider.saveSecureKey(key, value);
        }
    }
}
