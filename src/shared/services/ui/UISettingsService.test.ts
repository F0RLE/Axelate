import { describe, it, expect, beforeEach } from 'vitest';
import { UISettingsService } from './UISettingsService';
import type { UiStateStore } from '../state/UiStateStore';

import { createMockStore } from '@/test/mocks/mockUiStateStore';

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
