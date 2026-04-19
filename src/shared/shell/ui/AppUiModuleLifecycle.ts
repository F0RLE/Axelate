import type { IApp } from '../../types/coreTypes';
import type { ModulePlatformService } from '../../services/ModulePlatformService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

type LaunchAppFn = (id: string) => Promise<void>;

type AppUiModuleLifecycleDeps = {
    platformService: ModulePlatformService;
    tracer: LoggerService;
    getSelectedApp: (category: string) => IApp | undefined;
    isSelectedInAnotherAiSlot: (category: string, appId: string) => boolean;
    resolveAppById: (appId: string) => IApp | undefined;
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
            await launchApp(app.id);
        } catch (err: unknown) {
            this._deps.tracer.error(`[AppUI] Failed to launch selected module ${app.id}:`, err);
            return;
        }

        const currentVersion = this._launchSelectionVersions.get(category);
        const isCurrentSelection = this._deps.getSelectedApp(category)?.id === app.id;
        if (currentVersion === launchSelectionVersion && isCurrentSelection) {
            return;
        }

        if (category.startsWith('ai') && this._deps.isSelectedInAnotherAiSlot(category, app.id)) {
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
            category.startsWith('ai') &&
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
            .then(() => {
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
}
