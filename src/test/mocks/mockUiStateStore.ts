import { vi } from 'vitest';
import type { UiStateStore, IUIState } from '@/shared/services/state/UiStateStore';

export function createMockStore(initial?: Partial<IUIState>): UiStateStore {
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
        pending_chat_reveal: false,
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
