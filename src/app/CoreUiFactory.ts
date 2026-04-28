import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { ChatController } from '@/features/chat/chat';
import { DownloadUI } from '@/features/downloads/ui/DownloadUI';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { NavigationUI } from '@/infrastructure/navigation/NavigationUI';
import { AppUI } from '@/shared/shell/AppUI';
import type { EventBus } from '@/shared/services/EventBus';
import type { ModulePlatformService } from '@/shared/services/ModulePlatformService';
import type { IApp } from '@/shared/types/coreTypes';
import type { CatalogService } from '@/shared/services/CatalogService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { SettingsService } from '@/features/settings/services/SettingsService';
import type { UISettingsService } from '@/shared/services/ui/UISettingsService';
import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { UiStateStore } from '@/shared/services/state/UiStateStore';
import type { WindowService } from '@/shared/services/WindowService';
import { Particles } from '@/shared/shell/Particles';
import { SidebarUI } from '@/shared/shell/SidebarUI';
import { WindowUI } from '@/shared/shell/WindowUI';
import type { MonitoringService } from '@/features/monitoring/services/MonitoringService';
import type { SoundService } from '@/shared/services/SoundService';
import type { ConsoleLogService } from '@/features/console/services/ConsoleLogService';
import type {
    ClosableDeferredUiController,
    DeferredUiController,
    ModuleSettingsUiController,
} from './CoreUiContracts';
import { LazyMonitoringUiAdapter } from './LazyUiAdapters';
import { createModuleSettingsGateway } from './CoreUiBridgeHelpers';
import { createConsoleUI, createModuleSettingsUI, createSettingsUI } from './CoreDeferredUiFactory';
import { createChatController } from './CoreChatFactory';

export type CoreUiBundle = {
    appUI: AppUI;
    i18nUI: I18nUI;
    windowUI: WindowUI;
    navigationUI: NavigationUI;
    sidebarUI: SidebarUI;
    downloadUI: DownloadUI;
    settingsUI: ClosableDeferredUiController;
    moduleSettingsUI: ModuleSettingsUiController;
    particles: Particles;
    monitoringUI: DeferredUiController;
    consoleUI: DeferredUiController;
    chatController: ChatController;
};

type CreateAppUIDeps = {
    modulePlatformService: ModulePlatformService;
    navigation: NavigationService;
    eventBus: EventBus;
    catalog: CatalogService;
    i18n: I18nService;
    tracer: LoggerService;
    stateStore: UiStateStore;
    bridge: {
        launchApp: (category: string, app: IApp) => Promise<void>;
    };
    moduleSettingsUI: {
        openModuleSettings: (app: IApp) => Promise<void>;
    };
    aiBridge: AIBridge;
};

type CreateCoreUiBundleDeps = {
    modulePlatformService: ModulePlatformService;
    navigation: NavigationService;
    eventBus: EventBus;
    catalog: CatalogService;
    i18n: I18nService;
    tracer: LoggerService;
    stateStore: UiStateStore;
    bridge: {
        launchApp: (category: string, app: IApp) => Promise<void>;
    };
    aiBridge: AIBridge;
    windowService: WindowService;
    uiSettings: UISettingsService;
    soundService: SoundService;
    settingsService: SettingsService;
    aiSettings: AISettingsService;
    tauriProvider: TauriProvider;
    monitoringService: MonitoringService;
    consoleLogService: ConsoleLogService;
};

function createCatalogReader(catalog: CatalogService): (category: string) => IApp[] {
    return (category: string): IApp[] => {
        const currentCatalog = catalog.getCatalog();
        if (category === 'ai') {
            return currentCatalog.ai;
        }
        if (category === 'services') {
            return currentCatalog.services;
        }
        return [];
    };
}

export function createAppUI(deps: CreateAppUIDeps): AppUI {
    return new AppUI(
        deps.modulePlatformService,
        deps.navigation,
        deps.eventBus,
        createCatalogReader(deps.catalog),
        deps.i18n.t.bind(deps.i18n),
        {
            tracer: deps.tracer,
            uiState: {
                removeSelectedModule: (category) => {
                    deps.stateStore.removeSelectedModule(category);
                },
                setSelectedModule: (category, moduleData) => {
                    deps.stateStore.setSelectedModule(category, moduleData);
                },
            },
            launchApp: async (category, app) => {
                await deps.bridge.launchApp(category, app);
            },
            openModuleSettings: (app) => {
                void deps.moduleSettingsUI.openModuleSettings(app);
            },
            stopAiProvider: () => {
                deps.aiBridge.stopProvider();
            },
        },
    );
}

export function createDownloadUI(
    i18n: I18nService,
    modulePlatformService: ModulePlatformService,
): DownloadUI {
    const downloadUI = new DownloadUI(i18n);
    downloadUI.setOnPause((moduleId: string) => {
        void modulePlatformService.pauseDownload(moduleId);
    });
    downloadUI.setOnResume((moduleId: string) => {
        void modulePlatformService.resumeDownload(moduleId);
    });
    downloadUI.setOnCancel((moduleId: string) => {
        void modulePlatformService.cancelDownload(moduleId);
    });
    return downloadUI;
}

export function createCoreUiBundle(deps: CreateCoreUiBundleDeps): CoreUiBundle {
    const i18nUI = new I18nUI(deps.i18n);
    const particles = new Particles();
    let moduleSettingsUI: ModuleSettingsUiController | null = null;
    const moduleSettingsGateway = createModuleSettingsGateway(() => moduleSettingsUI);

    const appUI = createAppUI({
        modulePlatformService: deps.modulePlatformService,
        navigation: deps.navigation,
        eventBus: deps.eventBus,
        catalog: deps.catalog,
        i18n: deps.i18n,
        tracer: deps.tracer,
        stateStore: deps.stateStore,
        bridge: deps.bridge,
        moduleSettingsUI: moduleSettingsGateway,
        aiBridge: deps.aiBridge,
    });
    const windowUI = new WindowUI(
        deps.windowService,
        deps.uiSettings,
        deps.soundService,
        deps.tracer,
        deps.i18n,
        undefined,
        deps.eventBus,
    );
    const navigationUI = new NavigationUI(
        deps.navigation,
        deps.eventBus,
        deps.tracer,
        deps.soundService,
    );
    const sidebarUI = new SidebarUI(
        deps.uiSettings,
        deps.tracer,
        deps.soundService,
        deps.windowService,
    );
    const downloadUI = createDownloadUI(deps.i18n, deps.modulePlatformService);
    const settingsUI = createSettingsUI({
        settingsService: deps.settingsService,
        uiSettings: deps.uiSettings,
        aiSettings: deps.aiSettings,
        i18n: deps.i18n,
        i18nUI,
        tauriProvider: deps.tauriProvider,
        navigation: deps.navigation,
        tracer: deps.tracer,
        appUI,
    });
    moduleSettingsUI = createModuleSettingsUI({
        settingsService: deps.settingsService,
        uiSettings: deps.uiSettings,
        aiSettings: deps.aiSettings,
        i18n: deps.i18n,
        i18nUI,
        tauriProvider: deps.tauriProvider,
        navigation: deps.navigation,
        tracer: deps.tracer,
        appUI,
        eventBus: deps.eventBus,
        moduleSettingsUIRef: moduleSettingsGateway,
        aiBridge: deps.aiBridge,
        modulePlatformService: deps.modulePlatformService,
    });
    const monitoringUI = new LazyMonitoringUiAdapter(deps.monitoringService);
    const consoleUI = createConsoleUI({
        consoleLogService: deps.consoleLogService,
        eventBus: deps.eventBus,
        i18n: deps.i18n,
        tauriProvider: deps.tauriProvider,
        appUI,
    });
    const chatController = createChatController({
        aiBridge: deps.aiBridge,
        i18n: deps.i18n,
        soundService: deps.soundService,
        tauriProvider: deps.tauriProvider,
        tracer: deps.tracer,
        appUI,
        eventBus: deps.eventBus,
        stateStore: deps.stateStore,
    });

    return {
        appUI,
        i18nUI,
        windowUI,
        navigationUI,
        sidebarUI,
        downloadUI,
        settingsUI,
        moduleSettingsUI,
        particles,
        monitoringUI,
        consoleUI,
        chatController,
    };
}
