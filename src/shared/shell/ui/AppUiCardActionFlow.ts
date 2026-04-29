import type { IApp } from '../../types/coreTypes';
import type { ModulePlatformService } from '../../services/ModulePlatformService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import {
    markModuleCardDownloadPaused,
    markModuleCardDownloadResuming,
} from './ModuleCardDownloadProgress';
import { resolveDownloadButtonAction } from './ModuleCardActions';

type AppUiCardActionFlowDeps = {
    platformService: ModulePlatformService;
    tracer: LoggerService;
    isComingSoonApp: (app: IApp) => boolean;
    showComingSoonToast: () => void;
    showToast: (message: string, type?: string) => void;
    handleDeleteModule: (app: IApp, category: string) => Promise<void>;
    handleDownloadModule: (app: IApp, category: string, btn: HTMLElement | null) => Promise<void>;
    pauseDownload: (moduleId: string) => Promise<boolean>;
    resumeDownload: (moduleId: string) => Promise<boolean>;
    cancelDownload: (moduleId: string) => Promise<boolean>;
    resetDownloadButton: (btn: HTMLElement | null) => void;
    restoreDownloadButtonLabel: (btn: HTMLElement | null) => void;
    performSelectionAction: (category: string, app: IApp) => void;
    translate: (key: string, fallback: string) => string;
};

export class AppUiCardActionFlow {
    constructor(private readonly _deps: AppUiCardActionFlowDeps) {}

    public async handleAppCardClick(event: MouseEvent, app: IApp, category: string): Promise<void> {
        if (this._deps.isComingSoonApp(app)) {
            this._deps.showComingSoonToast();
            return;
        }
        if (await this.tryDeleteAction(event, app, category)) return;
        if (await this.tryDownloadAction(event, app, category)) return;
        if (!this._deps.platformService.isApiModule(app) && app.installed !== true) {
            return;
        }
        this._deps.performSelectionAction(category, app);
    }

    public async tryDeleteAction(event: MouseEvent, app: IApp, category: string): Promise<boolean> {
        const target = event.target as HTMLElement;
        if (target.closest('.app-delete-badge') === null) {
            return false;
        }

        event.stopPropagation();
        await this._deps.handleDeleteModule(app, category);
        return true;
    }

    public async tryDownloadAction(
        event: MouseEvent,
        app: IApp,
        category: string,
    ): Promise<boolean> {
        if (this._deps.isComingSoonApp(app)) {
            this._deps.showComingSoonToast();
            return true;
        }

        const btn = this._resolveDownloadButton(event);
        const clickedDownloadButton = (event.target as HTMLElement | null)?.closest(
            '.download-btn',
        );
        if (clickedDownloadButton === null && btn?.classList.contains('downloading') === true) {
            return false;
        }

        if (this._deps.platformService.isApiModule(app) || app.installed === true) {
            return false;
        }

        if (app.repoUrl === undefined || app.repoUrl === '') {
            this._deps.tracer.warn('[AppUI] Download URL is empty for module:', app.id);
            this._deps.showToast(
                this._deps.translate(
                    'ui.launcher.web.download_url_empty',
                    'Download URL is not available',
                ),
                'warning',
            );
            return true;
        }

        event.stopPropagation();
        if (clickedDownloadButton !== null && btn?.classList.contains('downloading') === true) {
            await this._handleActiveDownloadAction(event, app, btn);
            return true;
        }

        await this._deps.handleDownloadModule(app, category, btn);
        return true;
    }

    private _resolveDownloadButton(event: MouseEvent): HTMLElement | null {
        const currentTarget = event.currentTarget as HTMLElement | null;
        const card = currentTarget ?? (event.target as HTMLElement).closest('.app-card');
        return card?.querySelector<HTMLElement>('.download-btn') ?? null;
    }

    private async _handleActiveDownloadAction(
        event: MouseEvent,
        app: IApp,
        btn: HTMLElement,
    ): Promise<void> {
        const action = resolveDownloadButtonAction(btn as HTMLButtonElement, event);
        if (action === 'pause') {
            this._deps.tracer.info(`[AppUI] Pausing download for: ${app.id}`);
            if (await this._deps.pauseDownload(app.id)) {
                markModuleCardDownloadPaused(btn);
            } else {
                this._showDownloadControlFailed(app.id, 'pause');
            }
            return;
        }

        if (action === 'resume') {
            this._deps.tracer.info(`[AppUI] Resuming download for: ${app.id}`);
            if (await this._deps.resumeDownload(app.id)) {
                markModuleCardDownloadResuming(btn);
            } else {
                this._showDownloadControlFailed(app.id, 'resume');
            }
            return;
        }

        await this._cancelDownload(app, btn);
    }

    private async _cancelDownload(app: IApp, btn: HTMLElement | null): Promise<void> {
        this._deps.tracer.info(`[AppUI] Cancelling download for: ${app.id}`);
        try {
            if (await this._deps.cancelDownload(app.id)) {
                this._deps.resetDownloadButton(btn);
                this._deps.restoreDownloadButtonLabel(btn);
            } else {
                this._showDownloadControlFailed(app.id, 'cancel');
            }
        } catch (err) {
            this._deps.tracer.error(`[AppUI] Cancel failed for ${app.id}:`, err);
            this._showDownloadControlFailed(app.id, 'cancel');
        }
    }

    private _showDownloadControlFailed(moduleId: string, action: string): void {
        this._deps.tracer.warn(`[AppUI] Download ${action} failed for ${moduleId}`);
        this._deps.showToast(
            this._deps.translate(
                'ui.launcher.web.download_control_error',
                'Download control failed',
            ),
            'warning',
        );
    }
}
