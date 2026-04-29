import type { IApp } from '../../types/coreTypes';
import { resolveCatalogCategory } from '../../utils/moduleCategoryPolicy';
import type { ModulePlatformService } from '../../services/ModulePlatformService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

type ModalBridge = {
    isAppSelectionOpen(): boolean;
    isViewingCategory(category: string): boolean;
    refreshCurrentSelection(apps?: IApp[], selectedId?: string | null): void;
};

type AppUiModuleFlowDeps = {
    platformService: ModulePlatformService;
    tracer: LoggerService;
    modalManager: ModalBridge;
    getCatalogApps: (category: string) => IApp[];
    getSelectedAppId: (category: string) => string | null;
    clearModuleCard: (category: string) => void;
    openAppSelection: (category: string, apps?: IApp[]) => void;
    markSlotCardAsInstalled: (card: HTMLElement, app: IApp) => void;
    showToast: (message: string, type?: string) => void;
    translate: (key: string, fallback: string) => string;
};

export class AppUiModuleFlow {
    constructor(private readonly _deps: AppUiModuleFlowDeps) {}

    public async handleDeleteModule(app: IApp, category: string): Promise<void> {
        this._deps.tracer.info('[AppUI] Remove module clicked:', app.id);
        try {
            await this._deps.platformService.delete(app, category);
            app.installed = false;

            if (this._deps.getSelectedAppId(category) === app.id) {
                this._deps.clearModuleCard(category);
            }

            if (this._deps.modalManager.isAppSelectionOpen()) {
                this._deps.openAppSelection(
                    category,
                    this._deps.getCatalogApps(this._toRawCategory(category)),
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
        this.prepareDownloadButton(btn);

        try {
            const outcome = await this._deps.platformService.download(app);
            if (outcome !== 'completed') {
                this.onModalDownloadInterrupted(btn, outcome);
                return;
            }
            this.onModalDownloadSuccess(btn, app, category);
        } catch (err: unknown) {
            this.onModalDownloadError(btn, err);
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
        this._deps.showToast(
            this._getLocalizedError(err, 'ui.launcher.web.download_error', 'Download failed'),
            'error',
        );
    }

    private _getLocalizedError(err: unknown, fallbackKey: string, fallbackText: string): string {
        const error = err as Error;
        const msg = error.message.startsWith('ui.') ? error.message : fallbackKey;
        const fallback = msg === fallbackKey ? fallbackText : msg;
        return this._deps.translate(msg, fallback);
    }

    private _toRawCategory(category: string): string {
        return resolveCatalogCategory(category);
    }
}
