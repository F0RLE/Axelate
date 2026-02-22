import type { UiStateStore, ThinkingLevel } from '../state/UiStateStore';

export class AISettingsService {
    constructor(private readonly _store: UiStateStore) {}

    public getSelectedAIModel(appId: string): string | undefined {
        return this._store.getState().selected_ai_models[appId];
    }

    public setSelectedAIModel(appId: string, modelKey: string): void {
        this._store.updateNestedState('selected_ai_models', appId, modelKey);
    }

    public getThinkingLevel(appId: string): ThinkingLevel {
        return this._store.getState().ai_thinking_level[appId] ?? 'high';
    }

    public setThinkingLevel(appId: string, level: ThinkingLevel): void {
        this._store.updateNestedState('ai_thinking_level', appId, level);
    }

    public getLastActiveProvider(): string | null {
        return this._store.getState().last_active_provider;
    }

    public setLastActiveProvider(providerId: string | null): void {
        this._store.updateState({ last_active_provider: providerId });
    }

    public getAiSessionId(): string | null {
        return this._store.getState().ai_session_id;
    }

    public setAiSessionId(sessionId: string | null): void {
        this._store.updateState({ ai_session_id: sessionId });
    }
}
