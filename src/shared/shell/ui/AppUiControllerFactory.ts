import type { IApp } from '../../types/coreTypes';
import type { EventBus } from '../../services/EventBus';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { ModulePlatformService } from '../../services/ModulePlatformService';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import { AppUiChrome } from './AppUiChrome';
import { ToastManager } from './ToastManager';
import { ModuleCardRenderer } from './ModuleCardRenderer';
import { AppUiDashboardController } from './AppUiDashboardController';
import { AppUiDashboardCardView } from './AppUiDashboardCardView';
import { SkeletonManager } from './SkeletonManager';
import { AppUiActionFeedbackController } from './AppUiActionFeedbackController';
import { ModalManager } from './ModalManager';
import { AppUiModuleFlow } from './AppUiModuleFlow';
import { AppUiCardActionFlow } from './AppUiCardActionFlow';
import { AppUiModuleLifecycle } from './AppUiModuleLifecycle';
import { AppUiSelectionFlow } from './AppUiSelectionFlow';
import { AppUiLifecycleBindings } from './AppUiLifecycleBindings';
import type { AppUiSelectionState } from './AppUiSelectionState';

type AppUIStateDeps = {
    removeSelectedModule: (category: string) => void;
    setSelectedModule: (category: string, moduleData: Partial<IApp>) => void;
    updateState: (updates: { last_active_provider: string | null }) => void;
};

type AppUIDeps = {
    tracer: LoggerService;
    uiState: AppUIStateDeps;
    launchApp: (moduleId: string) => Promise<void>;
    openModuleSettings: (app: IApp) => void;
    stopAiProvider: () => void;
};

type AppUiFactoryCore = {
    platformService: ModulePlatformService;
    navigation: NavigationService;
    eventBus: EventBus;
    catalogResolver: (category: string) => IApp[];
    translate: (key: string, fallback: string) => string;
    deps: AppUIDeps;
    selectionState: AppUiSelectionState;
};

export class AppUiControllerFactory {
    public createChrome(core: AppUiFactoryCore): AppUiChrome {
        return new AppUiChrome(core.translate, core.deps.tracer);
    }

    public createToastManager(): ToastManager {
        return new ToastManager();
    }

    public createCardRenderer(core: AppUiFactoryCore): ModuleCardRenderer {
        return new ModuleCardRenderer({
            checkInstalled: async (moduleId) => await core.platformService.checkInstalled(moduleId),
            translate: core.translate,
            tracer: core.deps.tracer,
            openModuleSettings: (app) => {
                core.deps.openModuleSettings(app);
            },
        });
    }

    public createDashboardController(
        core: AppUiFactoryCore,
        chrome: AppUiChrome,
        cardRenderer: ModuleCardRenderer,
        actions: {
            clearModuleCard: (category: string) => void;
            openAppSelection: (category: string) => void;
            updateMultiSlotBadge: () => void;
        },
    ): AppUiDashboardController {
        return new AppUiDashboardController({
            tracer: core.deps.tracer,
            chrome,
            cardRenderer,
            selectionState: core.selectionState,
            openModuleSettings: (app: IApp) => {
                core.deps.openModuleSettings(app);
            },
            clearModuleCard: (category: string) => actions.clearModuleCard(category),
            removeSelectedModule: (category: string) => {
                core.deps.uiState.removeSelectedModule(category);
            },
            openAppSelection: (category: string) => actions.openAppSelection(category),
            updateMultiSlotBadge: () => actions.updateMultiSlotBadge(),
        });
    }

    public createDashboardCardView(
        core: AppUiFactoryCore,
        chrome: AppUiChrome,
        cardRenderer: ModuleCardRenderer,
        actions: {
            clearModuleCard: (category: string) => void;
        },
    ): AppUiDashboardCardView {
        return new AppUiDashboardCardView({
            chrome,
            cardRenderer,
            isApiModule: (app) => core.platformService.isApiModule(app),
            openModuleSettings: (app) => {
                core.deps.openModuleSettings(app);
            },
            clearModuleCard: (category) => actions.clearModuleCard(category),
            removeSelectedModule: (category) => {
                core.deps.uiState.removeSelectedModule(category);
            },
        });
    }

    public createSkeletonManager(): SkeletonManager {
        return new SkeletonManager();
    }

    public createActionFeedbackController(chrome: AppUiChrome): AppUiActionFeedbackController {
        return new AppUiActionFeedbackController(chrome);
    }

    public createModalManager(
        core: AppUiFactoryCore,
        cardRenderer: ModuleCardRenderer,
        actions: {
            handleAppCardClick: (e: MouseEvent, app: IApp, category: string) => Promise<void>;
        },
    ): ModalManager {
        return new ModalManager(
            cardRenderer,
            (e, app, category) => {
                void actions.handleAppCardClick(e, app, category);
            },
            (capability) => core.selectionState.get(`ai_${capability}`)?.id ?? null,
            async (app) => await core.platformService.download(app),
            async (app) => {
                await core.platformService.cancelDownload(app.id);
                await core.platformService.delete(app);
            },
            core.translate,
            core.deps.tracer,
            core.navigation,
        );
    }

    public createModuleFlow(
        core: AppUiFactoryCore,
        modalManager: ModalManager,
        dashboardCardView: AppUiDashboardCardView,
        actions: {
            clearModuleCard: (category: string) => void;
            openAppSelection: (category: string, apps?: IApp[]) => void;
            showToast: (message: string, type?: string) => void;
        },
    ): AppUiModuleFlow {
        return new AppUiModuleFlow({
            platformService: core.platformService,
            tracer: core.deps.tracer,
            modalManager,
            getCatalogApps: (category) => this._getCatalogApps(core, category),
            getSelectedAppId: (category) => core.selectionState.get(category)?.id ?? null,
            clearModuleCard: (category) => actions.clearModuleCard(category),
            openAppSelection: (category, apps) => actions.openAppSelection(category, apps),
            markCardAsInstalled: (card, app) => dashboardCardView.markCardAsInstalled(card, app),
            showToast: (message, type = 'info') => actions.showToast(message, type),
            translate: core.translate,
        });
    }

    public createCardActionFlow(
        core: AppUiFactoryCore,
        moduleFlow: AppUiModuleFlow,
        actions: {
            isComingSoonApp: (app: IApp) => boolean;
            showComingSoonToast: () => void;
            showToast: (message: string, type?: string) => void;
            handleDeleteModule: (app: IApp, category: string) => Promise<void>;
            performSelectionAction: (category: string, app: IApp) => void;
        },
    ): AppUiCardActionFlow {
        return new AppUiCardActionFlow({
            platformService: core.platformService,
            tracer: core.deps.tracer,
            isComingSoonApp: (app) => actions.isComingSoonApp(app),
            showComingSoonToast: () => actions.showComingSoonToast(),
            showToast: (message, type = 'info') => actions.showToast(message, type),
            handleDeleteModule: (app, category) => actions.handleDeleteModule(app, category),
            handleDownloadModule: (app, category, btn) =>
                moduleFlow.handleDownloadModule(app, category, btn),
            resetDownloadButton: (btn) => moduleFlow.resetDownloadButton(btn),
            restoreDownloadButtonLabel: (btn) => moduleFlow.restoreDownloadButtonLabel(btn),
            performSelectionAction: (category, app) =>
                actions.performSelectionAction(category, app),
            translate: core.translate,
        });
    }

    public createModuleLifecycle(
        core: AppUiFactoryCore,
        actions: {
            resolveAppById: (appId: string) => IApp | undefined;
            showToast: (message: string, type?: string) => void;
        },
    ): AppUiModuleLifecycle {
        return new AppUiModuleLifecycle({
            platformService: core.platformService,
            tracer: core.deps.tracer,
            getSelectedApp: (category) => core.selectionState.get(category),
            isSelectedInAnotherAiSlot: (category, appId) =>
                core.selectionState.isSelectedInAnotherAiSlot(category, appId),
            resolveAppById: (appId) => actions.resolveAppById(appId),
            translate: core.translate,
            showToast: (message, type = 'info') => actions.showToast(message, type),
        });
    }

    public createSelectionFlow(
        core: AppUiFactoryCore,
        moduleLifecycle: AppUiModuleLifecycle,
        modalManager: ModalManager,
        actions: {
            clearModuleCard: (category: string) => void;
            updateModuleCard: (category: string, app: IApp) => void;
        },
    ): AppUiSelectionFlow {
        return new AppUiSelectionFlow({
            getSelectedApp: (category) => core.selectionState.get(category),
            clearModuleCard: (category) => actions.clearModuleCard(category),
            updateModuleCard: (category, app) => actions.updateModuleCard(category, app),
            updateModalSelection: (appId) => modalManager.updateSelection(appId),
            bumpLaunchSelectionVersion: (category) =>
                moduleLifecycle.bumpLaunchSelectionVersion(category),
            stopSelectedApp: (app) => core.platformService.stop(app),
            launchSelectedApp: (category, app, launchSelectionVersion, launchApp) =>
                moduleLifecycle.launchSelectedApp(category, app, launchSelectionVersion, launchApp),
            removeSelectedModule: (category) => {
                core.deps.uiState.removeSelectedModule(category);
            },
            setSelectedModule: (category, moduleData) => {
                core.deps.uiState.setSelectedModule(category, moduleData);
            },
            launchApp: (moduleId) => core.deps.launchApp(moduleId),
        });
    }

    public createLifecycleBindings(
        core: AppUiFactoryCore,
        modalManager: ModalManager,
        actions: {
            closeAppSelection: () => void;
        },
    ): AppUiLifecycleBindings {
        return new AppUiLifecycleBindings({
            eventBus: core.eventBus,
            onLanguageChanged: () => {
                modalManager.refreshCurrentSelection();
            },
            onPageChange: ({ pageId }) => {
                if (pageId !== 'modules' && pageId !== 'page-modules') {
                    actions.closeAppSelection();
                }
            },
        });
    }

    private _getCatalogApps(core: AppUiFactoryCore, category: string): IApp[] {
        try {
            return core.catalogResolver(category);
        } catch (err: unknown) {
            core.deps.tracer.warn(
                `[AppUI] Failed to read catalog category ${category}: ${String(err)}`,
            );
            return [];
        }
    }
}
