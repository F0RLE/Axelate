import type { UiStateStore, ThinkingLevel } from '../state/UiStateStore';

const LOCAL_LOW_THINKING_DEFAULTS = new Set(['llamacpp']);
const DEFAULT_LOCAL_MAX_OUTPUT_TOKENS = 384;

export class AISettingsService {
    constructor(private readonly _store: UiStateStore) {}

    public getSelectedAIModel(appId: string): string | undefined {
        return this._store.getState().selected_ai_models[appId];
    }

    public setSelectedAIModel(appId: string, modelKey: string): void {
        this._store.updateNestedState('selected_ai_models', appId, modelKey);
    }

    public getThinkingLevel(appId: string): ThinkingLevel {
        const savedLevel = this._store.getState().ai_thinking_level[appId];
        if (savedLevel !== undefined) {
            return savedLevel;
        }

        return LOCAL_LOW_THINKING_DEFAULTS.has(appId) ? 'low' : 'off';
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

    public getAiSessionId(): string | null {
        return this._store.getState().ai_session_id;
    }

    public setAiSessionId(sessionId: string | null): void {
        this._store.updateState({ ai_session_id: sessionId });
    }
}
