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
        refreshCurrentSelection: vi.fn(),
    };

    const getCatalogApps = vi.fn();
    const getSelectedAppId = vi.fn();
    const clearModuleCard = vi.fn();
    const openAppSelection = vi.fn();
    const markCardAsInstalled = vi.fn();
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
            openAppSelection,
            markCardAsInstalled,
            showToast,
            translate,
        });
    });

    it('reopens modal after delete when selection stays open', async () => {
        const app = { id: 'svc', name: 'Service', installed: true } as IApp;
        platformService.delete.mockResolvedValue(undefined);
        modalManager.isAppSelectionOpen.mockReturnValue(true);
        getCatalogApps.mockReturnValue([{ id: 'svc', installed: false }]);
        getSelectedAppId.mockReturnValue('svc');

        await flow.handleDeleteModule(app, 'services');

        expect(app.installed).toBe(false);
        expect(clearModuleCard).toHaveBeenCalledWith('services');
        expect(openAppSelection).toHaveBeenCalledWith('services', [
            { id: 'svc', installed: false },
        ]);
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
        expect(markCardAsInstalled).toHaveBeenCalledWith(card, app);
        expect(modalManager.refreshCurrentSelection).toHaveBeenCalledWith([app], 'svc');
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
