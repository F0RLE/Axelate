import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DownloadSettingsService } from './DownloadSettingsService';
import type { UiStateStore } from '../state/UiStateStore';
import type { IBridge } from '@/shared/types/IBridge';

import { createMockStore } from '@/test/mocks/mockUiStateStore';
import { createMockBridge } from '@/test/mocks/mockBridge';

describe('DownloadSettingsService', () => {
    let store: UiStateStore;
    let bridge: IBridge;
    let service: DownloadSettingsService;

    beforeEach(() => {
        store = createMockStore();
        bridge = createMockBridge();
        service = new DownloadSettingsService(store, bridge);
    });

    it('should return default download settings', () => {
        const settings = service.getDownloadSettings();
        expect(settings).toEqual({ limitEnabled: false, maxSpeed: 50 });
    });

    it('should update download settings and trigger sync', () => {
        const syncSpy = vi.spyOn(service, 'syncToBackend');
        service.setDownloadSettings(true, 100);
        const settings = service.getDownloadSettings();
        expect(settings).toEqual({ limitEnabled: true, maxSpeed: 100 });
        expect(syncSpy).toHaveBeenCalledOnce();
    });

    it('should not invoke backend on sync when not Tauri', () => {
        service.syncToBackend();
        expect(bridge.invoke).not.toHaveBeenCalled();
    });

    it('should invoke backend on sync when in Tauri', () => {
        bridge = createMockBridge(true);
        service = new DownloadSettingsService(store, bridge);
        service.syncToBackend();
        expect(bridge.invoke).toHaveBeenCalledWith('set_download_settings', {
            enabled: false,
            max_speed: 50,
        });
    });

    it('should handle backend sync error gracefully', () => {
        bridge = createMockBridge(true);
        (bridge.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network fail'));
        service = new DownloadSettingsService(store, bridge);
        // Should not throw
        expect(() => service.syncToBackend()).not.toThrow();
    });
});
