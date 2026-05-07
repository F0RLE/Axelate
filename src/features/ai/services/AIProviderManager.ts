import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { getModelData, getMostPowerfulModel } from '../utils/catalogHelpers';
import type { IAICatalogApp } from '../types/aiTypes';
import type { AIProviderManagerContext } from './AIBridgeContext';
import {
    getCustomProviderDisplayName,
    isCustomProviderId,
} from '@/shared/utils/customProviderSupport';
import { isCloudProviderId, resolveProviderSecretService } from '@/shared/utils/providerSupport';

type AIProviderManagerLogger = Pick<LoggerService, 'info' | 'error'>;

export class AIProviderManager {
    private _context: AIProviderManagerContext | null = null;
    private _activeProviderId: string | null = null;
    private _hasApiKey = false;

    // Session Management
    private _sessionId: string = 'default';

    public constructor(private readonly _tracer: AIProviderManagerLogger) {}

    public setContext(context: AIProviderManagerContext): void {
        this._context = context;
    }

    public setCore(context: AIProviderManagerContext): void {
        this.setContext(context);
    }

    public async init(): Promise<void> {
        // Initialize Session ID from secure storage.
        const secureSid = await this._getSecureVal('ai_session_id').catch((error: unknown) => {
            this._tracer.error('[AIProviderManager] Failed to read ai_session_id:', error);
            return null;
        });
        let sid = secureSid;
        if (!this._isValidSessionId(sid)) {
            sid = crypto.randomUUID();
        }

        if (secureSid !== sid) {
            await this._saveSecureVal('ai_session_id', sid);
        }

        this._sessionId = sid;
    }

    public async startProvider(providerId: string): Promise<boolean> {
        if (this._activeProviderId === providerId) {
            await this.refreshActiveApiKey();
            if (!this.isActive()) {
                this.stopProvider();
                return false;
            }

            return true;
        }

        this._tracer.info(`[AIProviderManager] Switching provider to: ${providerId}`);

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

            // Persist state
            if (this._context) {
                this._context.aiSettings.setSelectedAIModel(providerId, model);
            }

            return true;
        } catch (error) {
            this._tracer.error('[AIProviderManager] Failed to start provider:', error);
            return false;
        }
    }

    public stopProvider(): void {
        if (this._activeProviderId !== null) {
            this._activeProviderId = null;
            this._hasApiKey = false;
            this._tracer.info('[AIProviderManager] Provider stopped');
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
        if (this._activeProviderId === null) {
            return '';
        }

        return this._resolveModel(this._activeProviderId);
    }

    public get sessionId(): string {
        return this._sessionId;
    }

    public get maxOutputTokens(): number | undefined {
        if (this._activeProviderId === null) return undefined;
        const modelData = getModelData(
            this._getAiCatalogApps(),
            this._activeProviderId,
            this.model,
        );
        return modelData?.maxOutputTokens ?? undefined;
    }

    public get contextWindow(): number | undefined {
        if (this._activeProviderId === null) return undefined;
        const modelData = getModelData(
            this._getAiCatalogApps(),
            this._activeProviderId,
            this.model,
        );
        return modelData?.contextWindow ?? undefined;
    }

    public getProviderDisplayName(id: string): string {
        const customDisplayName = getCustomProviderDisplayName(id);
        if (customDisplayName !== null) {
            return customDisplayName;
        }

        const catalogProvider = this._getAiCatalogApps().find((provider) => provider.id === id);
        return catalogProvider?.name ?? id;
    }

    /**
     * Re-fetches the API key for the active provider safely.
     * Use this before sending messages to ensure key validity if it changed.
     */
    public async refreshActiveApiKey(): Promise<void> {
        if (this._activeProviderId !== null) {
            const hasApiKey = await this._resolveHasApiKey(this._activeProviderId);
            this._hasApiKey = this._isLocalProvider(this._activeProviderId) || hasApiKey;
            if (!this._hasApiKey && !this._isLocalProvider(this._activeProviderId)) {
                this.stopProvider();
            }
        }
    }

    // --- Private Helpers ---

    private async _resolveHasApiKey(providerId: string): Promise<boolean> {
        const secretService = resolveProviderSecretService(providerId);
        if (secretService === null) {
            return false;
        }

        return await this._hasSecureVal(secretService);
    }

    /**
     * Returns true if the provider ID represents a local engine
     * (not a cloud API provider requiring an API key).
     * Any ID that doesn't match a known cloud provider prefix is treated as local.
     */
    private _isLocalProvider(providerId: string): boolean {
        if (isCustomProviderId(providerId)) {
            return false;
        }

        return !isCloudProviderId(providerId);
    }

    private _getPersistedModel(providerId: string): string | null {
        if (!this._context) return null;
        const persistedModel = this._context.aiSettings.getSelectedAIModel(providerId);
        if (typeof persistedModel !== 'string' || persistedModel.trim() === '') {
            return null;
        }

        return persistedModel.trim();
    }

    private _getDefaultModel(providerId: string): string {
        const catalogModel = getMostPowerfulModel(this._getAiCatalogApps(), providerId);
        if (typeof catalogModel === 'string' && catalogModel.trim() !== '') {
            return catalogModel;
        }

        if (this._isLocalProvider(providerId)) {
            return 'default';
        }

        return '';
    }

    private _resolveModel(providerId: string): string {
        return this._getPersistedModel(providerId) ?? this._getDefaultModel(providerId);
    }

    private _getAiCatalogApps(): IAICatalogApp[] {
        const context = this._context as
            | (Partial<AIProviderManagerContext> & {
                  catalog?: { getCatalog: () => unknown };
              })
            | null;
        const catalog = context?.catalog?.getCatalog() as unknown;
        if (typeof catalog !== 'object' || catalog === null) {
            return [];
        }

        const aiCatalog = (catalog as { ai?: unknown[] }).ai;
        return Array.isArray(aiCatalog) ? (aiCatalog as IAICatalogApp[]) : [];
    }

    private async _getSecureVal(key: string): Promise<string | null> {
        if (this._context?.tauriProvider.getSecureKey) {
            return await this._context.tauriProvider.getSecureKey(key);
        }
        return null;
    }

    private async _hasSecureVal(key: string): Promise<boolean> {
        if (this._context && typeof this._context.tauriProvider.hasSecureKey === 'function') {
            return Boolean(await this._context.tauriProvider.hasSecureKey(key));
        }

        const value = await this._getSecureVal(key);
        return value !== null && value.trim() !== '';
    }

    private async _saveSecureVal(key: string, value: string): Promise<void> {
        if (this._context?.tauriProvider.saveSecureKey) {
            try {
                await this._context.tauriProvider.saveSecureKey(key, value);
            } catch (error: unknown) {
                this._tracer.error(`[AIProviderManager] Failed to persist ${key}:`, error);
            }
        }
    }

    private _isValidSessionId(value: string | null): value is string {
        return typeof value === 'string' && value.trim() !== '';
    }
}
