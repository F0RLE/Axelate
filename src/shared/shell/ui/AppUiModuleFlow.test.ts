import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IApp } from '../../types/coreTypes';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { AppUiModuleFlow } from './AppUiModuleFlow';

describe('AppUiModuleFlow', () => {
    const platformService = {
        delete: vi.fn(),
        download: vi.fn(),
    } as unknown as {
        delete: ReturnType<typeof vi.fn>;
        download: ReturnType<typeof vi.fn>;
    };

    const modalManager = {
        isAppSelectionOpen: vi.fn(),
        isViewingCategory: vi.fn(),
        closeAppSelection: vi.fn(),
        openAppSelection: vi.fn(),
        refreshCurrentSelection: vi.fn(),
    };

    const getCatalogApps = vi.fn();
    const getSelectedAppId = vi.fn();
    const clearModuleCard = vi.fn();
    const markSlotCardAsInstalled = vi.fn();
    const showToast = vi.fn();
    const translate = vi.fn((_key: string, fallback: string) => fallback);

    let flow: AppUiModuleFlow;

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        flow = new AppUiModuleFlow({
            platformService: platformService as never,
            tracer: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
            } as unknown as LoggerService,
            modalManager,
            getCatalogApps,
            getSelectedAppId,
            clearModuleCard,
            markSlotCardAsInstalled,
            showToast,
            translate,
        });
    });

    it('refreshes modal after deleting the selected module', async () => {
        const app = { id: 'svc', name: 'Service', installed: true } as IApp;
        platformService.delete.mockResolvedValue(undefined);
        modalManager.isAppSelectionOpen.mockReturnValue(true);
        getCatalogApps.mockReturnValue([{ id: 'svc', installed: false }]);
        getSelectedAppId.mockReturnValue('svc');

        await flow.handleDeleteModule(app, 'services');

        expect(platformService.delete).toHaveBeenCalledWith(app, 'services');
        expect(app.installed).toBe(false);
        expect(clearModuleCard).toHaveBeenCalledWith('services');
        expect(modalManager.refreshCurrentSelection).toHaveBeenCalledWith(
            [{ id: 'svc', installed: false }],
            null,
        );
    });

    it('refreshes modal after deleting an unselected module without selecting it', async () => {
        const app = { id: 'svc', name: 'Service', installed: true } as IApp;
        platformService.delete.mockResolvedValue(undefined);
        modalManager.isAppSelectionOpen.mockReturnValue(true);
        getCatalogApps.mockReturnValue([{ id: 'svc', installed: false }]);
        getSelectedAppId.mockReturnValue('other');

        await flow.handleDeleteModule(app, 'services');

        expect(clearModuleCard).not.toHaveBeenCalled();
        expect(modalManager.refreshCurrentSelection).toHaveBeenCalledWith(
            [{ id: 'svc', installed: false }],
            'other',
        );
    });

    it('refreshes modal selection after successful download', () => {
        const app = { id: 'svc', name: 'Service', installed: false } as IApp;
        const card = document.createElement('div');
        card.className = 'app-card';
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading indeterminate';
        card.appendChild(btn);
        getCatalogApps.mockReturnValue([app]);
        getSelectedAppId.mockReturnValue('svc');
        modalManager.isViewingCategory.mockReturnValue(true);

        flow.onModalDownloadSuccess(btn, app, 'services');

        expect(app.installed).toBe(true);
        expect(btn.classList.contains('downloading')).toBe(false);
        expect(markSlotCardAsInstalled).toHaveBeenCalledWith(card, app);
        expect(modalManager.refreshCurrentSelection).toHaveBeenCalledWith([app], 'svc');
    });

    it('does not refresh modal selection after download success in another category', () => {
        const app = { id: 'svc', name: 'Service', installed: false } as IApp;
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading indeterminate';
        modalManager.isViewingCategory.mockReturnValue(false);

        flow.onModalDownloadSuccess(btn, app, 'services');

        expect(app.installed).toBe(true);
        expect(btn.classList.contains('downloading')).toBe(false);
        expect(modalManager.refreshCurrentSelection).not.toHaveBeenCalled();
    });

    it('resets download button and shows a toast after download errors', () => {
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading indeterminate';
        btn.innerHTML = `
            <span class="download-pct"></span>
            <span class="download-label" style="display:none"></span>
        `;

        flow.onModalDownloadError(btn, new Error('broken'));

        expect(btn.classList.contains('downloading')).toBe(false);
        expect(btn.querySelector<HTMLElement>('.download-pct')?.style.display).toBe('none');
        expect(btn.querySelector<HTMLElement>('.download-label')?.textContent).toBe('Download');
        expect(showToast).toHaveBeenCalledWith('Download failed', 'error');
    });

    it('falls back to default download error text for non-error rejections', () => {
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading indeterminate';

        flow.onModalDownloadError(btn, 'network down');

        expect(btn.classList.contains('downloading')).toBe(false);
        expect(showToast).toHaveBeenCalledWith('Download failed', 'error');
    });

    it('keeps paused download button state for resume', async () => {
        const app = { id: 'svc', name: 'Service', installed: false } as IApp;
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading indeterminate';
        btn.dataset['downloadStatus'] = 'paused';
        btn.innerHTML = `
            <span class="download-pct"></span>
            <span class="download-label" style="display:none"></span>
        `;
        platformService.download.mockResolvedValue('paused');

        await flow.handleDownloadModule(app, 'services', btn);

        expect(app.installed).toBe(false);
        expect(btn.classList.contains('downloading')).toBe(true);
        expect(btn.dataset['downloadStatus']).toBe('paused');
        expect(markSlotCardAsInstalled).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('restores download button label after cancel cleanup', () => {
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading indeterminate';
        btn.innerHTML = `
            <span class="download-pct"></span>
            <span class="download-label" style="display:none"></span>
        `;

        flow.resetDownloadButton(btn);
        flow.restoreDownloadButtonLabel(btn);

        expect(btn.classList.contains('downloading')).toBe(false);
        expect(btn.querySelector<HTMLElement>('.download-pct')?.style.display).toBe('none');
        expect(btn.querySelector<HTMLElement>('.download-label')?.textContent).toBe('Download');
    });
});
