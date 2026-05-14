import type { IApp, ReleaseDownloadSelection } from '../../types/coreTypes';
import { resolveCatalogCategory } from '../../utils/moduleCategoryPolicy';
import type { ModulePlatformService } from '../../services/ModulePlatformService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { openDownloadSelectionDialog } from './DownloadSelectionDialog';
import { openIntegrationUrlDialog } from './IntegrationImportDialog';
import type { IntegrationImportAction } from './ModalManagerSupport';
import { open } from '@tauri-apps/plugin-dialog';
import { downloadDir } from '@tauri-apps/api/path';

const CUSTOM_INTEGRATION_GUIDE_URL =
    'https://github.com/F0RLE/Axelate/blob/nightly/docs/localization/en/CUSTOM_INTEGRATIONS.md';

type ModalBridge = {
    isAppSelectionOpen(): boolean;
    isViewingCategory(category: string): boolean;
    closeAppSelection(): void;
    suspendAppSelection(): boolean;
    resumeAppSelection(): void;
    openAppSelection(category: string, apps: IApp[], selectedId?: string): void;
    refreshCurrentSelection(apps?: IApp[], selectedId?: string | null): void;
};

type AppUiModuleFlowDeps = {
    platformService: ModulePlatformService;
    tracer: LoggerService;
    modalManager: ModalBridge;
    getCatalogApps: (category: string) => IApp[];
    getSelectedAppId: (category: string) => string | null;
    getIntegrationImportLastDirectory: () => string | null;
    setIntegrationImportLastDirectory: (path: string | null) => void;
    clearModuleCard: (category: string) => void;
    markSlotCardAsInstalled: (card: HTMLElement, app: IApp) => void;
    showToast: (message: string, type?: string) => void;
    translate: (key: string, fallback: string) => string;
    reloadCatalog: () => Promise<void>;
    openExternalUrl: (url: string) => Promise<void>;
};

export class AppUiModuleFlow {
    constructor(private readonly _deps: AppUiModuleFlowDeps) {}

    public async handleDeleteModule(app: IApp, category: string): Promise<void> {
        this._deps.tracer.info('[AppUI] Remove module clicked:', app.id);
        try {
            await this._deps.platformService.delete(app, category);
            await this._deps.reloadCatalog();
            app.installed = false;

            const wasSelected = this._deps.getSelectedAppId(category) === app.id;
            if (wasSelected) {
                this._deps.clearModuleCard(category);
            }

            if (this._deps.modalManager.isAppSelectionOpen()) {
                this._deps.modalManager.refreshCurrentSelection(
                    this._deps.getCatalogApps(this._toRawCategory(category)),
                    wasSelected ? null : this._deps.getSelectedAppId(category),
                );
            }
        } catch (err: unknown) {
            this._deps.tracer.error('[AppUI] Delete error:', err);
            this._deps.showToast(
                this._getLocalizedError(err, 'ui.launcher.web.delete_model_error', 'Delete error'),
                'error',
            );
        }
    }

    public async handleDownloadModule(
        app: IApp,
        category: string,
        btn: HTMLElement | null,
    ): Promise<void> {
        this._deps.tracer.info('[AppUI] Download module clicked:', app.id);
        let activeButton = btn;

        try {
            const releaseSelection = await this._resolveReleaseDownloadSelection(app, category);
            if (releaseSelection === null && app.dlType === 'release') {
                return;
            }

            activeButton =
                app.dlType === 'release' ? (this._findModalDownloadButton(app) ?? btn) : btn;

            this.prepareDownloadButton(activeButton);

            const outcome = await this._deps.platformService.download(app, releaseSelection);
            if (outcome !== 'completed') {
                this.onModalDownloadInterrupted(activeButton, outcome);
                return;
            }
            this.onModalDownloadSuccess(activeButton, app, category);
        } catch (err: unknown) {
            this.onModalDownloadError(activeButton, err);
        }
    }

    private async _resolveReleaseDownloadSelection(
        app: IApp,
        category: string,
    ): Promise<ReleaseDownloadSelection | undefined | null> {
        if (app.dlType !== 'release') {
            return undefined;
        }

        const shouldRestoreSelection = this._deps.modalManager.isAppSelectionOpen();
        const suspendedSelection = shouldRestoreSelection
            ? this._deps.modalManager.suspendAppSelection()
            : false;

        try {
            return await openDownloadSelectionDialog({
                app,
                loadOptions: () => this._deps.platformService.getReleaseDownloadOptions(app),
                translate: this._deps.translate,
            });
        } finally {
            if (suspendedSelection) {
                this._deps.modalManager.resumeAppSelection();
            } else if (shouldRestoreSelection) {
                this._restoreAppSelection(category);
            }
        }
    }

    public prepareDownloadButton(btn: HTMLElement | null): void {
        if (btn === null) return;

        btn.classList.add('downloading', 'indeterminate');
        btn.style.setProperty('--download-progress', '0%');

        const pct = btn.querySelector<HTMLElement>('.download-pct');
        if (pct) {
            pct.style.display = '';
            pct.textContent = '0%';
        }

        const label = btn.querySelector<HTMLElement>('.download-label');
        if (label) {
            label.textContent = '';
        }
    }

    public resetDownloadButton(btn: HTMLElement | null): void {
        if (btn === null) return;

        btn.classList.remove('downloading', 'indeterminate');
        btn.style.removeProperty('--download-progress');
        btn.style.pointerEvents = 'auto';
    }

    public restoreDownloadButtonLabel(btn: HTMLElement | null): void {
        if (btn === null) return;

        const pct = btn.querySelector<HTMLElement>('.download-pct');
        if (pct) {
            pct.style.display = 'none';
        }

        const label = btn.querySelector<HTMLElement>('.download-label');
        if (label) {
            label.style.display = '';
            label.textContent = this._deps.translate('ui.launcher.module.download', 'Download');
        }
    }

    public onModalDownloadSuccess(btn: HTMLElement | null, app: IApp, category: string): void {
        app.installed = true;
        this.resetDownloadButton(btn);

        const card =
            btn?.closest<HTMLElement>('.module-slot-card') ??
            btn?.closest<HTMLElement>('.app-card');
        if (card instanceof HTMLElement) {
            this._deps.markSlotCardAsInstalled(card, app);
        }

        if (this._deps.modalManager.isViewingCategory(category)) {
            this._deps.modalManager.refreshCurrentSelection(
                this._deps.getCatalogApps(this._toRawCategory(category)),
                this._deps.getSelectedAppId(category),
            );
        }
    }

    public onModalDownloadInterrupted(
        btn: HTMLElement | null,
        outcome: 'paused' | 'cancelled',
    ): void {
        if (outcome === 'paused') {
            return;
        }

        this.resetDownloadButton(btn);
        this.restoreDownloadButtonLabel(btn);
    }

    public onModalDownloadError(btn: HTMLElement | null, err: unknown): void {
        this._deps.tracer.error('[AppUI] Download error:', err);
        this.resetDownloadButton(btn);
        this.restoreDownloadButtonLabel(btn);
        this._deps.showToast(
            this._getLocalizedError(err, 'ui.launcher.web.download_error', 'Download failed'),
            'error',
        );
    }

    public async handleIntegrationImport(action: IntegrationImportAction): Promise<void> {
        if (action === 'guide') {
            await this._deps.openExternalUrl(CUSTOM_INTEGRATION_GUIDE_URL);
            return;
        }

        try {
            const moduleId = await this._runIntegrationImportAction(action);
            if (moduleId === null) {
                return;
            }

            await this._deps.reloadCatalog();
            if (this._deps.modalManager.isViewingCategory('services')) {
                this._deps.modalManager.refreshCurrentSelection(
                    this._deps.getCatalogApps('services'),
                    this._deps.getSelectedAppId('services'),
                );
            }

            this._deps.showToast(
                this._deps.translate(
                    'ui.launcher.integrations.import.success',
                    'Integration added',
                ),
                'success',
            );
        } catch (error) {
            this._deps.tracer.error('[AppUI] Integration import error:', error);
            this._deps.showToast(
                this._getLocalizedError(
                    error,
                    'ui.launcher.integrations.import.error',
                    'Integration import failed',
                ),
                'error',
            );
        }
    }

    private async _runIntegrationImportAction(
        action: Exclude<IntegrationImportAction, 'guide'>,
    ): Promise<string | null> {
        if (action === 'local') {
            const path = await this._openLocalIntegrationSource();
            return path === null
                ? null
                : await this._deps.platformService.importIntegrationPath(path);
        }

        if (action === 'archive') {
            const path = await this._openArchiveIntegrationSource();
            return path === null
                ? null
                : await this._deps.platformService.importIntegrationPath(path);
        }

        const url = await this._openIntegrationUrlSource();
        return url === null ? null : await this._deps.platformService.importIntegrationUrl(url);
    }

    private async _openIntegrationUrlSource(): Promise<string | null> {
        const shouldRestoreSelection = this._deps.modalManager.isAppSelectionOpen();
        const suspendedSelection = shouldRestoreSelection
            ? this._deps.modalManager.suspendAppSelection()
            : false;

        try {
            return await openIntegrationUrlDialog({ translate: this._deps.translate });
        } finally {
            if (suspendedSelection) {
                this._deps.modalManager.resumeAppSelection();
            }
        }
    }

    private async _openLocalIntegrationSource(): Promise<string | null> {
        const selectedPath = normalizeDialogPath(
            await open({
                directory: true,
                defaultPath: await this._getIntegrationImportDefaultPath(),
                multiple: false,
                recursive: true,
                title: this._deps.translate(
                    'ui.launcher.integrations.import.folder_title',
                    'Choose integration folder',
                ),
            }),
        );
        if (selectedPath !== null) {
            this._deps.setIntegrationImportLastDirectory(selectedPath);
        }
        return selectedPath;
    }

    private async _openArchiveIntegrationSource(): Promise<string | null> {
        const selectedPath = normalizeDialogPath(
            await open({
                directory: false,
                defaultPath: await this._getIntegrationImportDefaultPath(),
                multiple: false,
                title: this._deps.translate(
                    'ui.launcher.integrations.import.archive_title',
                    'Choose integration archive',
                ),
                filters: [
                    {
                        name: this._deps.translate(
                            'ui.launcher.integrations.import.archive',
                            'Archive',
                        ),
                        extensions: ['zip', 'tar', 'gz', 'tgz', 'xz', 'txz', '7z'],
                    },
                ],
            }),
        );
        if (selectedPath !== null) {
            this._deps.setIntegrationImportLastDirectory(
                getParentDirectory(selectedPath) ?? selectedPath,
            );
        }
        return selectedPath;
    }

    private async _getIntegrationImportDefaultPath(): Promise<string | undefined> {
        const savedPath = this._deps.getIntegrationImportLastDirectory();
        if (savedPath !== null) {
            return savedPath;
        }

        try {
            return await downloadDir();
        } catch {
            return undefined;
        }
    }

    private _getLocalizedError(err: unknown, fallbackKey: string, fallbackText: string): string {
        const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
        const msg = message.startsWith('ui.') ? message : fallbackKey;
        const fallback = msg === fallbackKey ? fallbackText : msg;
        return this._deps.translate(msg, fallback);
    }

    private _toRawCategory(category: string): string {
        return resolveCatalogCategory(category);
    }

    private _restoreAppSelection(category: string): void {
        this._deps.modalManager.openAppSelection(
            category,
            this._deps.getCatalogApps(this._toRawCategory(category)),
            this._deps.getSelectedAppId(category) ?? undefined,
        );
    }

    private _findModalDownloadButton(app: IApp): HTMLElement | null {
        const cards = document.querySelectorAll<HTMLElement>('#app-modal-list .app-card');
        for (const card of cards) {
            if (card.dataset['appId'] === app.id) {
                return card.querySelector<HTMLElement>('.download-btn');
            }
        }
        return null;
    }
}

function normalizeDialogPath(value: string | string[] | null): string | null {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }
    return null;
}

function getParentDirectory(path: string): string | null {
    const normalized = path.replace(/\\/gu, '/');
    const lastSeparator = normalized.lastIndexOf('/');
    if (lastSeparator <= 0) {
        return null;
    }

    const parent = path.slice(0, lastSeparator);
    return parent.trim().length === 0 ? null : parent;
}
