import type { UiStateStore, ThinkingLevel } from '../state/UiStateStore';

const DEFAULT_LOCAL_MAX_OUTPUT_TOKENS = 384;
const DEFAULT_CLOUD_API_BASE_URL = 'https://openrouter.ai/api/v1';

export class AISettingsService {
    constructor(private readonly _store: UiStateStore) {}

    public getSelectedAIModel(appId: string): string | undefined {
        return this._store.getState().selected_ai_models[appId];
    }

    public setSelectedAIModel(appId: string, modelKey: string): void {
        this._store.updateNestedState('selected_ai_models', appId, modelKey);
    }

    public getApiBaseUrl(appId: string, fallback = DEFAULT_CLOUD_API_BASE_URL): string {
        const savedBaseUrl = this._store.getState().ai_api_base_urls[appId];
        if (typeof savedBaseUrl === 'string' && savedBaseUrl.trim() !== '') {
            return savedBaseUrl.trim();
        }

        return fallback;
    }

    public setApiBaseUrl(appId: string, baseUrl: string): boolean {
        const normalized = this.normalizeApiBaseUrl(baseUrl);
        if (normalized === null) {
            return false;
        }

        this._store.updateNestedState('ai_api_base_urls', appId, normalized);
        return true;
    }

    public normalizeApiBaseUrl(baseUrl: string): string | null {
        const trimmed = baseUrl.trim().replace(/\/+$/u, '');
        if (trimmed.startsWith('https://') || trimmed.startsWith('http://localhost')) {
            return trimmed;
        }

        return null;
    }

    public getThinkingLevel(appId: string): ThinkingLevel {
        const savedLevel = this._store.getState().ai_thinking_level[appId];
        if (savedLevel !== undefined) {
            return savedLevel;
        }

        return 'off';
    }

    public setThinkingLevel(appId: string, level: ThinkingLevel): void {
        this._store.updateNestedState('ai_thinking_level', appId, level);
    }

    public getInternetAccessEnabled(appId: string): boolean {
        const savedValue = this._store.getState().ai_web_search_enabled[appId];
        if (typeof savedValue === 'boolean') {
            return savedValue;
        }

        return false;
    }

    public setInternetAccessEnabled(appId: string, enabled: boolean): void {
        this._store.updateNestedState('ai_web_search_enabled', appId, enabled);
    }

    public getLocalMaxOutputTokens(appId: string): number {
        const savedValue = this._store.getState().local_max_output_tokens[appId];
        if (typeof savedValue === 'number' && Number.isFinite(savedValue) && savedValue > 0) {
            return savedValue;
        }

        return DEFAULT_LOCAL_MAX_OUTPUT_TOKENS;
    }

    public setLocalMaxOutputTokens(appId: string, tokens: number): void {
        const normalized = Math.max(1, Math.min(Math.trunc(tokens), 32768));
        this._store.updateNestedState('local_max_output_tokens', appId, normalized);
    }
}
