import type { IApp } from '../../types/coreTypes';
import type { ModulePlatformService } from '../../services/ModulePlatformService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { isAiCategory } from '../../utils/moduleCategoryPolicy';

type LaunchAppFn = (category: string, app: IApp) => Promise<void>;

type AppUiModuleLifecycleDeps = {
    platformService: ModulePlatformService;
    tracer: LoggerService;
    getSelectedApp: (category: string) => IApp | undefined;
    isSelectedInAnotherAiSlot: (category: string, appId: string) => boolean;
    resolveAppById: (appId: string) => IApp | undefined;
    updateRuntimeStatus: (category: string, app: IApp, status: string) => void;
    translate: (key: string, fallback: string) => string;
    showToast: (message: string, type?: string) => void;
};

export class AppUiModuleLifecycle {
    private readonly _launchSelectionVersions = new Map<string, number>();

    constructor(private readonly _deps: AppUiModuleLifecycleDeps) {}

    public bumpLaunchSelectionVersion(category: string): number {
        const nextVersion = (this._launchSelectionVersions.get(category) ?? 0) + 1;
        this._launchSelectionVersions.set(category, nextVersion);
        return nextVersion;
    }

    public async launchSelectedApp(
        category: string,
        app: IApp,
        launchSelectionVersion: number,
        launchApp: LaunchAppFn,
    ): Promise<void> {
        try {
            await launchApp(category, app);
        } catch (err: unknown) {
            this._deps.tracer.error(`[AppUI] Failed to launch selected module ${app.id}:`, err);
            this._deps.updateRuntimeStatus(category, app, 'stopped');
            return;
        }

        const currentVersion = this._launchSelectionVersions.get(category);
        const isCurrentSelection = this._deps.getSelectedApp(category)?.id === app.id;
        if (currentVersion === launchSelectionVersion && isCurrentSelection) {
            this._deps.updateRuntimeStatus(category, app, await this._resolveRuntimeStatus(app));
            return;
        }

        if (isAiCategory(category) && this._deps.isSelectedInAnotherAiSlot(category, app.id)) {
            return;
        }

        await this._deps.platformService.stop(app).catch((err: unknown) => {
            this._deps.tracer.warn(
                `[AppUI] Failed to stop stale launched module ${app.id}: ${String(err)}`,
            );
        });
    }

    public stopPreviousModule(card: HTMLElement, app: IApp, category: string): void {
        const previousModuleId = card.dataset['currentModule'];
        if (
            previousModuleId === undefined ||
            previousModuleId === '' ||
            previousModuleId === app.id
        ) {
            return;
        }

        if (
            isAiCategory(category) &&
            this._deps.isSelectedInAnotherAiSlot(category, previousModuleId)
        ) {
            return;
        }

        const previousApp =
            this._deps.resolveAppById(previousModuleId) ??
            ({
                id: previousModuleId,
                name: card.dataset['currentModuleName'] ?? previousModuleId,
            } as IApp);

        void this._deps.platformService
            .stop(previousApp)
            .then((stopped) => {
                if (!stopped) {
                    this._deps.tracer.warn(
                        `[AppUI] Previous module ${previousApp.id} did not report a successful stop`,
                    );
                    return;
                }
                const prevName =
                    previousApp.name ?? card.dataset['currentModuleName'] ?? previousModuleId;
                if (!this._deps.platformService.isApiModule(previousApp)) {
                    this._deps.showToast(
                        this._deps.translate('ui.launcher.module.stopped', `${prevName} stopped`),
                        'info',
                    );
                }
            })
            .catch((err: unknown) => {
                this._deps.tracer.warn(
                    `[AppUI] Failed to stop previous module ${previousApp.id}: ${String(err)}`,
                );
            });

        this._deps.tracer.info('[AppUI] Stopped previous module:', previousModuleId);
    }

    private async _resolveRuntimeStatus(app: IApp): Promise<string> {
        try {
            return await this._deps.platformService.getStatus(app);
        } catch (err: unknown) {
            this._deps.tracer.warn(
                `[AppUI] Failed to resolve runtime status for ${app.id}: ${String(err)}`,
            );
            return 'stopped';
        }
    }
}
