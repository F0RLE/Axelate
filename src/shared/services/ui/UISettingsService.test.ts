import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UISettingsService } from './UISettingsService';
import type { UiStateStore, IUIState } from '../state/UiStateStore';

function createMockStore(): UiStateStore {
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

describe('UISettingsService', () => {
    let store: UiStateStore;
    let service: UISettingsService;

    beforeEach(() => {
        store = createMockStore();
        service = new UISettingsService(store);
    });

    it('should get/set sidebar collapsed', () => {
        expect(service.getSidebarCollapsed()).toBe(false);
        service.setSidebarCollapsed(true);
        expect(service.getSidebarCollapsed()).toBe(true);
    });

    it('should get/set sidebar width', () => {
        expect(service.getSidebarWidth()).toBe(280);
        service.setSidebarWidth(200);
        expect(service.getSidebarWidth()).toBe(200);
    });

    it('should get/set hidden nav items', () => {
        expect(service.getHiddenNavItems()).toEqual([]);
        service.setHiddenNavItems(['dashboard', 'chat']);
        expect(service.getHiddenNavItems()).toEqual(['dashboard', 'chat']);
    });

    it('should get/set hidden monitors', () => {
        expect(service.getHiddenMonitors()).toEqual([]);
        service.setHiddenMonitors(['cpu']);
        expect(service.getHiddenMonitors()).toEqual(['cpu']);
    });

    it('should get card widths and set individual card width', () => {
        expect(service.getCardWidths()).toEqual({});
        service.setCardWidth('card-1', '300px');
        expect(service.getCardWidths()).toEqual({ 'card-1': '300px' });
    });

    it('should get last page (default home)', () => {
        expect(service.getLastPage()).toBe('home');
    });

    it('should set and get last page', () => {
        service.setLastPage('settings');
        expect(service.getLastPage()).toBe('settings');
    });

    it('should get/set zoom level', () => {
        expect(service.getZoomLevel()).toBe(1);
        service.setZoomLevel(1.5);
        expect(service.getZoomLevel()).toBe(1.5);
        // setZoomLevel calls updateState with markDirty=false
        expect(store.updateState).toHaveBeenCalledWith({ zoom_level: 1.5 }, false);
    });

    it('should get/set resolution zoom', () => {
        expect(service.getResolutionZoom('1920x1080')).toBeUndefined();
        service.setResolutionZoom('1920x1080', 1.2);
        expect(service.getResolutionZoom('1920x1080')).toBe(1.2);
    });

    it('should get/set sound enabled', () => {
        expect(service.getSoundEnabled()).toBe(true);
        service.setSoundEnabled(false);
        expect(service.getSoundEnabled()).toBe(false);
    });
});
