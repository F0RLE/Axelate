import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DownloadUI } from './DownloadUI';
import type { DownloadSettingsService } from '@/shared/services/downloads/DownloadSettingsService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';

describe('DownloadUI', () => {
    let downloadSettings: DownloadSettingsService;
    let i18nService: I18nService;
    let ui: DownloadUI;

    beforeEach(() => {
        // Reset DOM mocks
        document.body.innerHTML = `
            <div id="downloads-main-card" class="hidden"></div>
            <div id="downloads-empty-text"></div>
            <div id="downloads-progress-bar"></div>
            <div id="downloads-progress-text"></div>
            <div id="downloads-speed"></div>
            <div id="downloads-downloaded"></div>
            <div id="downloads-total"></div>
            <div id="downloads-item-label"></div>
            <div id="downloads-status"></div>
            <div id="downloads-eta"></div>
            <div id="download-speed-limit-toggle"></div>
            <div id="download-speed-slider"></div>
            <div id="speed-limit-value"></div>
            <div id="speed-limit-controls"></div>
        `;

        // Ensure inputs are actual InputElements for instanceof checks
        const toggle = document.createElement('input');
        toggle.id = 'download-speed-limit-toggle';
        toggle.type = 'checkbox';
        document.body.appendChild(toggle);

        const slider = document.createElement('input');
        slider.id = 'download-speed-slider';
        slider.type = 'range';
        document.body.appendChild(slider);

        // Remove duplicates from innerHTML (ids must be unique)
        const oldToggle = document.querySelector('div#download-speed-limit-toggle');
        if (oldToggle) oldToggle.remove();
        const oldSlider = document.querySelector('div#download-speed-slider');
        if (oldSlider) oldSlider.remove();

        downloadSettings = {
            getDownloadSettings: vi.fn().mockReturnValue({ limitEnabled: false, maxSpeed: 50 }),
            setDownloadSettings: vi.fn(),
        } as unknown as DownloadSettingsService;

        i18nService = {
            t: vi.fn((key: string, def?: string) => def ?? key),
        } as unknown as I18nService;

        ui = new DownloadUI(downloadSettings, i18nService);
    });

    it('should initialize and load settings', () => {
        expect(downloadSettings.getDownloadSettings).toHaveBeenCalled();
    });

    it('should render download progress correctly', () => {
        ui.renderDownloadsProgress({
            percent: 50,
            hasActive: true,
            speed: 1024 * 1024, // 1 MB/s
            downloaded: 50 * 1024 * 1024,
            total: 100 * 1024 * 1024,
            label: 'Test Download',
        });

        const bar = document.getElementById('downloads-progress-bar');
        const text = document.getElementById('downloads-progress-text');
        const speed = document.getElementById('downloads-speed');

        expect(bar?.style.width).toBe('50%');
        expect(text?.textContent).toBe('50.0%');
        expect(speed?.textContent).toBe('1.00 MB/s');
    });

    it('should show empty state when no active download', () => {
        ui.renderDownloadsProgress({ hasActive: false });

        const mainCard = document.getElementById('downloads-main-card');
        const emptyText = document.getElementById('downloads-empty-text');

        expect(mainCard?.classList.contains('hidden')).toBe(true);
        expect(emptyText?.classList.contains('hidden')).toBe(false);
    });

    it('should update settings when changed', () => {
        const toggle = document.getElementById('download-speed-limit-toggle') as HTMLInputElement;
        const slider = document.getElementById('download-speed-slider') as HTMLInputElement;

        // Manually trigger saveSettings since we are mocking DOM events
        toggle.checked = true;
        slider.value = '100';

        ui.saveSettings();

        expect(downloadSettings.setDownloadSettings).toHaveBeenCalledWith(true, 100);
    });
});
