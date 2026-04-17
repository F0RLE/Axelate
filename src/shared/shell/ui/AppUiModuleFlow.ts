import type { IApp } from '../../types/coreTypes';
import { getGlobalWin } from '../../utils/globalAccessor';
import type { ModulePlatformService } from '../../services/ModulePlatformService';
import { tracer } from '@/infrastructure/logging/LoggerService';

type ModalBridge = {
    isAppSelectionOpen(): boolean;
    isViewingCategory(category: string): boolean;
    refreshCurrentSelection(apps?: IApp[], selectedId?: string | null): void;
};

type AppUiModuleFlowDeps = {
    platformService: ModulePlatformService;
    modalManager: ModalBridge;
    getCatalogApps: (category: string) => IApp[];
    getSelectedAppId: (category: string) => string | null;
    clearModuleCard: (category: string) => void;
    openAppSelection: (category: string, apps?: IApp[]) => void;
    markCardAsInstalled: (card: HTMLElement, app: IApp) => void;
    showToast: (message: string, type?: string) => void;
};

export class AppUiModuleFlow {
    constructor(private readonly _deps: AppUiModuleFlowDeps) {}

    public async handleDeleteModule(app: IApp, category: string): Promise<void> {
        tracer.info('[AppUI] Remove module clicked:', app.id);
        try {
            await this._deps.platformService.delete(app);
            app.installed = false;

            if (this._deps.getSelectedAppId(category) === app.id) {
                this._deps.clearModuleCard(category);
            }

            if (this._deps.modalManager.isAppSelectionOpen()) {
                this._deps.openAppSelection(category, this._deps.getCatalogApps(this._toRawCategory(category)));
            }
        } catch (err: unknown) {
            tracer.error('[AppUI] Delete error:', err);
            this._deps.showToast(this._getLocalizedError(err, 'ui.launcher.web.delete_model_error', 'Delete error'), 'error');
        }
    }

    public async handleDownloadModule(
        app: IApp,
        category: string,
        btn: HTMLElement | null,
    ): Promise<void> {
        tracer.info('[AppUI] Download module clicked:', app.id);
        this.prepareDownloadButton(btn);

        try {
            await this._deps.platformService.download(app);
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
            label.textContent = this._translate('ui.launcher.module.download', 'Download');
        }
    }

    public onModalDownloadSuccess(btn: HTMLElement | null, app: IApp, category: string): void {
        app.installed = true;
        this.resetDownloadButton(btn);

        const card =
            btn?.closest<HTMLElement>('.model-card-premium') ??
            btn?.closest<HTMLElement>('.app-card');
        if (card instanceof HTMLElement) {
            this._deps.markCardAsInstalled(card, app);
        }

        if (this._deps.modalManager.isViewingCategory(category)) {
            this._deps.modalManager.refreshCurrentSelection(
                this._deps.getCatalogApps(this._toRawCategory(category)),
                this._deps.getSelectedAppId(category),
            );
        }
    }

    public onModalDownloadError(btn: HTMLElement | null, err: unknown): void {
        tracer.error('[AppUI] Download error:', err);
        this.resetDownloadButton(btn);
        this._deps.showToast(
            this._getLocalizedError(err, 'ui.launcher.web.download_error', 'Download failed'),
            'error',
        );
    }

    private _translate(key: string, fallback: string): string {
        const win = getGlobalWin();
        return typeof win.t === 'function' ? win.t(key, fallback) : fallback;
    }

    private _getLocalizedError(err: unknown, fallbackKey: string, fallbackText: string): string {
        const error = err as Error;
        const msg = error.message.startsWith('ui.') ? error.message : fallbackKey;
        const fallback = msg === fallbackKey ? fallbackText : msg;
        return this._translate(msg, fallback);
    }

    private _toRawCategory(category: string): string {
        return category.startsWith('ai') ? 'ai' : category;
    }
}
