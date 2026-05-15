import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IApp } from '../../types/coreTypes';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { AppUiModuleFlow } from './AppUiModuleFlow';
import { open } from '@tauri-apps/plugin-dialog';
import { downloadDir } from '@tauri-apps/api/path';

const integrationDialogMocks = vi.hoisted(() => ({
    openIntegrationUrlDialog: vi.fn(),
}));

vi.mock('./IntegrationImportDialog', () => ({
    openIntegrationUrlDialog: integrationDialogMocks.openIntegrationUrlDialog,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
    downloadDir: vi.fn(),
}));

describe('AppUiModuleFlow', () => {
    const platformService = {
        delete: vi.fn(),
        download: vi.fn(),
        importIntegrationPath: vi.fn(),
        importIntegrationUrl: vi.fn(),
    } as unknown as {
        delete: ReturnType<typeof vi.fn>;
        download: ReturnType<typeof vi.fn>;
        importIntegrationPath: ReturnType<typeof vi.fn>;
        importIntegrationUrl: ReturnType<typeof vi.fn>;
    };

    const modalManager = {
        isAppSelectionOpen: vi.fn(),
        isViewingCategory: vi.fn(),
        closeAppSelection: vi.fn(),
        suspendAppSelection: vi.fn(),
        resumeAppSelection: vi.fn(),
        openAppSelection: vi.fn(),
        refreshCurrentSelection: vi.fn(),
    };

    const getCatalogApps = vi.fn();
    const getSelectedAppId = vi.fn();
    const clearModuleCard = vi.fn();
    const markSlotCardAsInstalled = vi.fn();
    const showToast = vi.fn();
    const translate = vi.fn((_key: string, fallback: string) => fallback);
    const reloadCatalog = vi.fn().mockResolvedValue(undefined);
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const getIntegrationImportLastDirectory = vi.fn<() => string | null>();
    const setIntegrationImportLastDirectory = vi.fn();

    let flow: AppUiModuleFlow;

    beforeEach(() => {
        vi.clearAllMocks();
        getIntegrationImportLastDirectory.mockReturnValue(null);
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
            getIntegrationImportLastDirectory,
            setIntegrationImportLastDirectory,
            clearModuleCard,
            markSlotCardAsInstalled,
            showToast,
            translate,
            reloadCatalog,
            openExternalUrl,
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
        expect(reloadCatalog).toHaveBeenCalledOnce();
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

        expect(reloadCatalog).toHaveBeenCalledOnce();
        expect(clearModuleCard).not.toHaveBeenCalled();
        expect(modalManager.refreshCurrentSelection).toHaveBeenCalledWith(
            [{ id: 'svc', installed: false }],
            'other',
        );
    });

    it('reloads catalog and refreshes modal selection after successful download', async () => {
        const app = { id: 'svc', name: 'Service', installed: false } as IApp;
        const card = document.createElement('div');
        card.className = 'app-card';
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading indeterminate';
        card.appendChild(btn);
        getCatalogApps.mockReturnValue([app]);
        getSelectedAppId.mockReturnValue('svc');
        modalManager.isViewingCategory.mockReturnValue(true);

        await flow.onModalDownloadSuccess(btn, app, 'services');

        expect(app.installed).toBe(true);
        expect(btn.classList.contains('downloading')).toBe(false);
        expect(markSlotCardAsInstalled).toHaveBeenCalledWith(card, app);
        expect(reloadCatalog).toHaveBeenCalledOnce();
        expect(modalManager.refreshCurrentSelection).toHaveBeenCalledWith([app], 'svc');
    });

    it('does not refresh modal selection after download success in another category', async () => {
        const app = { id: 'svc', name: 'Service', installed: false } as IApp;
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading indeterminate';
        modalManager.isViewingCategory.mockReturnValue(false);

        await flow.onModalDownloadSuccess(btn, app, 'services');

        expect(app.installed).toBe(true);
        expect(btn.classList.contains('downloading')).toBe(false);
        expect(reloadCatalog).toHaveBeenCalledOnce();
        expect(modalManager.refreshCurrentSelection).not.toHaveBeenCalled();
    });

    it('keeps successful download UI when catalog refresh fails', async () => {
        const app = { id: 'svc', name: 'Service', installed: false } as IApp;
        const card = document.createElement('div');
        card.className = 'app-card';
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading indeterminate';
        card.appendChild(btn);
        reloadCatalog.mockRejectedValueOnce(new Error('catalog unavailable'));
        modalManager.isViewingCategory.mockReturnValue(true);

        await flow.onModalDownloadSuccess(btn, app, 'services');

        expect(app.installed).toBe(true);
        expect(markSlotCardAsInstalled).toHaveBeenCalledWith(card, app);
        expect(showToast).not.toHaveBeenCalled();
        expect(modalManager.refreshCurrentSelection).toHaveBeenCalled();
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

    it('opens integration folder picker in downloads by default and remembers selected folder', async () => {
        vi.mocked(downloadDir).mockResolvedValue('C:\\Users\\FORLE\\Downloads');
        vi.mocked(open).mockResolvedValue('C:\\Users\\FORLE\\Downloads\\Parser');
        platformService.importIntegrationPath.mockResolvedValue('telegram-parser');
        modalManager.isViewingCategory.mockReturnValue(false);

        await flow.handleIntegrationImport('local');

        expect(open).toHaveBeenCalledWith(
            expect.objectContaining({
                directory: true,
                defaultPath: 'C:\\Users\\FORLE\\Downloads',
            }),
        );
        expect(platformService.importIntegrationPath).toHaveBeenCalledWith(
            'C:\\Users\\FORLE\\Downloads\\Parser',
        );
        expect(setIntegrationImportLastDirectory).toHaveBeenCalledWith(
            'C:\\Users\\FORLE\\Downloads\\Parser',
        );

        getIntegrationImportLastDirectory.mockReturnValue('C:\\Users\\FORLE\\Downloads\\Parser');
        vi.mocked(open).mockResolvedValue(null);
        await flow.handleIntegrationImport('local');

        expect(open).toHaveBeenLastCalledWith(
            expect.objectContaining({
                defaultPath: 'C:\\Users\\FORLE\\Downloads\\Parser',
            }),
        );
    });

    it('does not import when local integration picking is cancelled', async () => {
        vi.mocked(downloadDir).mockResolvedValue('C:\\Users\\FORLE\\Downloads');
        vi.mocked(open).mockResolvedValue(null);

        await flow.handleIntegrationImport('local');

        expect(platformService.importIntegrationPath).not.toHaveBeenCalled();
        expect(reloadCatalog).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('imports integration archives with archive filters and remembers the archive folder', async () => {
        vi.mocked(downloadDir).mockResolvedValue('C:\\Users\\FORLE\\Downloads');
        vi.mocked(open).mockResolvedValue('C:\\Users\\FORLE\\Downloads\\Parser.zip');
        platformService.importIntegrationPath.mockResolvedValue('telegram-parser');

        await flow.handleIntegrationImport('archive');

        expect(open).toHaveBeenCalledWith(
            expect.objectContaining({
                directory: false,
                defaultPath: 'C:\\Users\\FORLE\\Downloads',
                filters: [
                    {
                        name: 'Archive',
                        extensions: ['zip', 'tar', 'gz', 'tgz', 'xz', 'txz', '7z'],
                    },
                ],
            }),
        );
        expect(platformService.importIntegrationPath).toHaveBeenCalledWith(
            'C:\\Users\\FORLE\\Downloads\\Parser.zip',
        );
        expect(setIntegrationImportLastDirectory).toHaveBeenCalledWith(
            'C:\\Users\\FORLE\\Downloads',
        );
    });

    it('refreshes the open integrations modal after local integration import', async () => {
        vi.mocked(downloadDir).mockResolvedValue('C:\\Users\\FORLE\\Downloads');
        vi.mocked(open).mockResolvedValue('C:\\Users\\FORLE\\Downloads\\Parser');
        platformService.importIntegrationPath.mockResolvedValue('telegram-parser');
        modalManager.isViewingCategory.mockReturnValue(true);
        getCatalogApps.mockReturnValue([{ id: 'telegram-parser', installed: true }]);
        getSelectedAppId.mockReturnValue('telegram-parser');

        await flow.handleIntegrationImport('local');

        expect(reloadCatalog).toHaveBeenCalledOnce();
        expect(modalManager.refreshCurrentSelection).toHaveBeenCalledWith(
            [{ id: 'telegram-parser', installed: true }],
            'telegram-parser',
        );
        expect(showToast).toHaveBeenCalledWith('Integration added', 'success');
    });

    it('opens the custom integration guide without importing anything', async () => {
        await flow.handleIntegrationImport('guide');

        expect(openExternalUrl).toHaveBeenCalledWith(
            'https://github.com/F0RLE/Axelate/blob/nightly/docs/localization/en/CUSTOM_INTEGRATIONS.md',
        );
        expect(platformService.importIntegrationPath).not.toHaveBeenCalled();
        expect(platformService.importIntegrationUrl).not.toHaveBeenCalled();
        expect(reloadCatalog).not.toHaveBeenCalled();
    });

    it('imports integration URLs while suspending and resuming the selection modal', async () => {
        modalManager.isAppSelectionOpen.mockReturnValue(true);
        modalManager.suspendAppSelection.mockReturnValue(true);
        modalManager.isViewingCategory.mockReturnValue(true);
        integrationDialogMocks.openIntegrationUrlDialog.mockResolvedValue(
            'https://github.com/F0RLE/Axelate-telegram-parser',
        );
        platformService.importIntegrationUrl.mockResolvedValue('axelate-telegram-parser');
        getCatalogApps.mockReturnValue([{ id: 'axelate-telegram-parser', installed: true }]);
        getSelectedAppId.mockReturnValue(null);

        await flow.handleIntegrationImport('url');

        expect(modalManager.suspendAppSelection).toHaveBeenCalledOnce();
        expect(integrationDialogMocks.openIntegrationUrlDialog).toHaveBeenCalledWith({
            translate,
        });
        expect(platformService.importIntegrationUrl).toHaveBeenCalledWith(
            'https://github.com/F0RLE/Axelate-telegram-parser',
        );
        expect(modalManager.resumeAppSelection).toHaveBeenCalledOnce();
        expect(reloadCatalog).toHaveBeenCalledOnce();
        expect(modalManager.refreshCurrentSelection).toHaveBeenCalledWith(
            [{ id: 'axelate-telegram-parser', installed: true }],
            null,
        );
        expect(showToast).toHaveBeenCalledWith('Integration added', 'success');
    });

    it('does not import URLs when the URL dialog is cancelled', async () => {
        modalManager.isAppSelectionOpen.mockReturnValue(true);
        modalManager.suspendAppSelection.mockReturnValue(true);
        integrationDialogMocks.openIntegrationUrlDialog.mockResolvedValue(null);

        await flow.handleIntegrationImport('url');

        expect(platformService.importIntegrationUrl).not.toHaveBeenCalled();
        expect(reloadCatalog).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
        expect(modalManager.resumeAppSelection).toHaveBeenCalledOnce();
    });

    it('shows localized import errors without refreshing catalog', async () => {
        vi.mocked(downloadDir).mockResolvedValue('C:\\Users\\FORLE\\Downloads');
        vi.mocked(open).mockResolvedValue('C:\\Users\\FORLE\\Downloads\\Broken');
        platformService.importIntegrationPath.mockRejectedValue(
            new Error('ui.launcher.integrations.import.error'),
        );

        await flow.handleIntegrationImport('local');

        expect(reloadCatalog).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('Integration import failed', 'error');
    });
});
