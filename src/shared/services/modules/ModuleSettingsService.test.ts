import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModuleSettingsService } from './ModuleSettingsService';
import type { UiStateStore, IUIState } from '../state/UiStateStore';

function createMockStore(): UiStateStore {
    const state: IUIState = {
        sidebar_collapsed: false,
        sidebar_manual_override: false,
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
        ai_web_search_enabled: {},
        local_max_output_tokens: {},
        integration_import_last_directory: null,
        pending_chat_reveal: false,
    };

    return {
        getState: vi.fn(() => state),
        updateNestedState: vi.fn((key: string, nestedKey: string, value: unknown) => {
            ((state as unknown as Record<string, unknown>)[key] as Record<string, unknown>)[
                nestedKey
            ] = value;
        }),
        removeNestedState: vi.fn((key: string, nestedKey: string) => {
            delete ((state as unknown as Record<string, unknown>)[key] as Record<string, unknown>)[
                nestedKey
            ];
        }),
    } as unknown as UiStateStore;
}

describe('ModuleSettingsService', () => {
    let store: UiStateStore;
    let service: ModuleSettingsService;

    beforeEach(() => {
        store = createMockStore();
        service = new ModuleSettingsService(store);
    });

    it('should return empty selected modules by default', () => {
        expect(service.getSelectedModules()).toEqual({});
    });

    it('should return undefined for unset module', () => {
        expect(service.getSelectedModule('ai')).toBeUndefined();
    });

    it('should set and get selected module', () => {
        const data = { id: 'gemini', name: 'Gemini' };
        service.setSelectedModule('ai', data);
        expect(service.getSelectedModule('ai')).toEqual(data);
    });

    it('should remove selected module', () => {
        service.setSelectedModule('ai', { id: 'gemini' });
        service.removeSelectedModule('ai');
        expect(service.getSelectedModule('ai')).toBeUndefined();
    });
});
