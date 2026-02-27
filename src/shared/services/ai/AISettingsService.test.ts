import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AISettingsService } from './AISettingsService';
import type { UiStateStore, IUIState } from '../state/UiStateStore';

function createMockStore(initial?: Partial<IUIState>): UiStateStore {
    const state: IUIState = {
        sidebar_collapsed: false,
        sidebar_width: 280,
        hidden_nav_items: [],
        hidden_monitors: [],
        card_widths: {},
        download_limit_enabled: false,
        download_max_speed: 50,
        selected_modules: {},
        zoom_level: 1,
        selected_ai_models: {},
        resolution_zoom: {},
        sound_enabled: true,
        ai_thinking_level: {},
        last_active_provider: null,
        ai_session_id: null,
        ...initial,
    };

    return {
        getState: vi.fn(() => state),
        updateState: vi.fn((updates: Partial<IUIState>) => Object.assign(state, updates)),
        updateNestedState: vi.fn((key: string, nestedKey: string, value: unknown) => {
            ((state as unknown as Record<string, unknown>)[key] as Record<string, unknown>)[
                nestedKey
            ] = value;
        }),
    } as unknown as UiStateStore;
}

describe('AISettingsService', () => {
    let store: UiStateStore;
    let service: AISettingsService;

    beforeEach(() => {
        store = createMockStore();
        service = new AISettingsService(store);
    });

    it('should get and set selected AI model', () => {
        expect(service.getSelectedAIModel('gemini')).toBeUndefined();
        service.setSelectedAIModel('gemini', 'gemini-pro');
        expect(service.getSelectedAIModel('gemini')).toBe('gemini-pro');
    });

    it('should get thinking level (default high)', () => {
        expect(service.getThinkingLevel('gemini')).toBe('high');
    });

    it('should set thinking level', () => {
        service.setThinkingLevel('gemini', 'low');
        expect(service.getThinkingLevel('gemini')).toBe('low');
    });

    it('should get and set last active provider', () => {
        expect(service.getLastActiveProvider()).toBeNull();
        service.setLastActiveProvider('gemini');
        expect(service.getLastActiveProvider()).toBe('gemini');
    });

    it('should set last active provider to null', () => {
        service.setLastActiveProvider('gemini');
        service.setLastActiveProvider(null);
        expect(service.getLastActiveProvider()).toBeNull();
    });

    it('should get and set AI session ID', () => {
        expect(service.getAiSessionId()).toBeNull();
        service.setAiSessionId('sess-123');
        expect(service.getAiSessionId()).toBe('sess-123');
    });

    it('should set AI session ID to null', () => {
        service.setAiSessionId('sess-123');
        service.setAiSessionId(null);
        expect(service.getAiSessionId()).toBeNull();
    });
});
