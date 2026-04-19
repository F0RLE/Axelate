import type { AIBridge } from '@/features/ai/services/AIBridge';
import { ChatController } from '@/features/chat/chat';
import { ConsoleUI } from '@/features/console/ui/ConsoleUI';
import { DownloadUI } from '@/features/downloads/ui/DownloadUI';
import { MonitoringUI } from '@/features/monitoring/ui/MonitoringUI';
import { ModuleSettingsUI } from '@/features/settings/ui/ModuleSettingsUI';
import { SettingsUI } from '@/features/settings/ui/SettingsUI';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { NavigationUI } from '@/infrastructure/navigation/NavigationUI';
import { AppUI } from '@/shared/shell/AppUI';
import type { EventBus } from '@/shared/services/EventBus';
import type { ModulePlatformService } from '@/shared/services/ModulePlatformService';
import { StateManager } from '@/shared/services/StateManager';
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
import { estimateTokenCount } from '@/features/chat/utils/chatUtils';
import type { MonitoringService } from '@/features/monitoring/services/MonitoringService';
import type { SoundService } from '@/shared/services/SoundService';

export type CoreUiBundle = {
    appUI: AppUI;
    i18nUI: I18nUI;
    windowUI: WindowUI;
    navigationUI: NavigationUI;
    sidebarUI: SidebarUI;
    downloadUI: DownloadUI;
    settingsUI: SettingsUI;
    moduleSettingsUI: ModuleSettingsUI;
    particles: Particles;
    monitoringUI: MonitoringUI;
    consoleUI: ConsoleUI;
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
        launchApp: (moduleId: string) => Promise<void>;
    };
    moduleSettingsUI: {
        openModuleSettings: (app: IApp) => Promise<void>;
    };
    aiBridge: AIBridge;
};

type CreateSettingsUIDeps = {
    settingsService: SettingsService;
    uiSettings: UISettingsService;
    aiSettings: AISettingsService;
    i18n: I18nService;
    i18nUI: I18nUI;
    tauriProvider: TauriProvider;
    navigation: NavigationService;
    tracer: LoggerService;
    appUI: AppUI;
};

type CreateModuleSettingsUIDeps = CreateSettingsUIDeps & {
    eventBus: EventBus;
    moduleSettingsUIRef: {
        openModuleSettings: (app: IApp) => Promise<void>;
    };
};

type CreateConsoleUIDeps = {
    consoleLogService: ConstructorParameters<typeof ConsoleUI>[0];
    eventBus: EventBus;
    i18n: I18nService;
    tauriProvider: TauriProvider;
    tracer: LoggerService;
    appUI: AppUI;
};

type CreateChatControllerDeps = {
    aiBridge: AIBridge;
    i18n: I18nService;
    soundService: ConstructorParameters<typeof ChatController>[2];
    tauriProvider: TauriProvider;
    tracer: LoggerService;
    appUI: AppUI;
    eventBus: EventBus;
    stateStore: UiStateStore;
};

type CreateStateManagerDeps = {
    tracer: LoggerService;
    stateStore: UiStateStore;
    windowService: WindowService;
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
        launchApp: (moduleId: string) => Promise<void>;
    };
    aiBridge: AIBridge;
    windowService: WindowService;
    uiSettings: UISettingsService;
    soundService: SoundService;
    settingsService: SettingsService;
    aiSettings: AISettingsService;
    tauriProvider: TauriProvider;
    monitoringService: MonitoringService;
    consoleLogService: ConstructorParameters<typeof ConsoleUI>[0];
};

type ModuleSettingsGateway = {
    openModuleSettings: (app: IApp) => Promise<void>;
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

function createToastBridge(
    appUI: AppUI,
): (message: string, type?: string, duration?: number) => void {
    return (message, type, duration) => {
        appUI.showToast(message, type, duration);
    };
}

function createModuleSettingsGateway(
    getModuleSettingsUI: () => ModuleSettingsUI | null,
): ModuleSettingsGateway {
    return {
        openModuleSettings: async (app) => {
            await getModuleSettingsUI()?.openModuleSettings(app);
        },
    };
}

function createClipboardWriter(tauriProvider: TauriProvider): (text: string) => Promise<void> {
    const isTauriRuntime = (): boolean => tauriProvider.isTauri();

    return async (text: string) => {
        if (isTauriRuntime()) {
            try {
                await tauriProvider.invoke('plugin:clipboard-manager|write_text', {
                    text,
                });
                return;
            } catch {
                /* fall through to browser clipboard */
            }
        }

        await navigator.clipboard.writeText(text);
    };
}

function createExternalUrlOpener(
    tauriProvider: TauriProvider,
    tracer: LoggerService,
): (url: string) => Promise<void> {
    const isTauriRuntime = (): boolean => tauriProvider.isTauri();

    return async (url) => {
        if (isTauriRuntime()) {
            try {
                await tauriProvider.invoke('plugin:shell|open', { path: url });
                return;
            } catch (error) {
                tracer.error('[ChatUI] Failed to open link via shell:', error);
            }
        }

        await tauriProvider.openUrl(url);
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
                updateState: (updates) => {
                    deps.stateStore.updateState(updates);
                },
            },
            launchApp: async (moduleId) => {
                await deps.bridge.launchApp(moduleId);
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
    downloadUI.setOnCancel((moduleId: string) => {
        void modulePlatformService.cancelDownload(moduleId);
    });
    return downloadUI;
}

export function createSettingsUI(deps: CreateSettingsUIDeps): SettingsUI {
    return new SettingsUI(
        deps.settingsService,
        deps.uiSettings,
        deps.aiSettings,
        deps.i18n,
        deps.i18nUI,
        deps.tauriProvider,
        deps.navigation,
        {
            tracer: deps.tracer,
            showToast: createToastBridge(deps.appUI),
        },
    );
}

export function createModuleSettingsUI(deps: CreateModuleSettingsUIDeps): ModuleSettingsUI {
    return new ModuleSettingsUI(
        deps.settingsService,
        deps.uiSettings,
        deps.aiSettings,
        deps.i18n,
        deps.i18nUI,
        deps.tauriProvider,
        deps.navigation,
        {
            eventBus: deps.eventBus,
            tracer: deps.tracer,
            showToast: createToastBridge(deps.appUI),
            reopenModuleSettings: (app) => {
                void deps.moduleSettingsUIRef.openModuleSettings(app);
            },
            closeAppSelection: () => {
                deps.appUI.closeAppSelection();
            },
        },
    );
}

export function createConsoleUI(deps: CreateConsoleUIDeps): ConsoleUI {
    return new ConsoleUI(deps.consoleLogService, {
        eventBus: deps.eventBus,
        translate: deps.i18n.t.bind(deps.i18n),
        showToast: createToastBridge(deps.appUI),
        copyText: createClipboardWriter(deps.tauriProvider),
    });
}

export function createChatController(deps: CreateChatControllerDeps): ChatController {
    const isTauriRuntime = (): boolean => deps.tauriProvider.isTauri();
    const showToast = createToastBridge(deps.appUI);
    const copyText = createClipboardWriter(deps.tauriProvider);
    const openExternalUrl = createExternalUrlOpener(deps.tauriProvider, deps.tracer);

    return new ChatController(deps.aiBridge, deps.i18n, deps.soundService, {
        showToast: (message, type = 'success', duration = 2000) =>
            showToast(message, type, duration),
        isTauriRuntime,
        openExternalUrl,
        copyText,
        getPendingChatRevealStore: () => ({
            getState: () => deps.stateStore.getState(),
            updateState: (updates) => deps.stateStore.updateState(updates),
        }),
        estimateTokens: async (text, model = 'gpt-4') => {
            if (isTauriRuntime()) {
                try {
                    return await deps.tauriProvider.invoke<number>('count_tokens', {
                        text,
                        model,
                    });
                } catch (error) {
                    deps.tracer.warn(
                        `[TokenCount] Backend failed, using heuristic: ${String(error)}`,
                    );
                }
            }

            return estimateTokenCount(text);
        },
        hostBridge: deps.tauriProvider,
        eventBus: deps.eventBus,
        getSelectedModule: (category) => deps.stateStore.getSelectedModule(category),
        tracer: deps.tracer,
    });
}

export function createStateManager(deps: CreateStateManagerDeps): StateManager {
    const stateManager = new StateManager(deps.tracer);
    stateManager.register({
        name: 'ui-state',
        saveAsync: () => deps.stateStore.saveAsync(),
        saveImmediate: () => deps.stateStore.saveImmediate(),
    });
    stateManager.register({
        name: 'window-state',
        saveAsync: () => deps.windowService.saveAsync(),
        saveImmediate: () => deps.windowService.saveImmediate(),
    });
    stateManager.init();
    deps.windowService.setBeforeCloseHook(() => stateManager.saveAllAsync());
    return stateManager;
}

export function createCoreUiBundle(deps: CreateCoreUiBundleDeps): CoreUiBundle {
    const i18nUI = new I18nUI(deps.i18n);
    const particles = new Particles();
    let moduleSettingsUI: ModuleSettingsUI | null = null;
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
    });
    const monitoringUI = new MonitoringUI(deps.monitoringService);
    const consoleUI = createConsoleUI({
        consoleLogService: deps.consoleLogService,
        eventBus: deps.eventBus,
        i18n: deps.i18n,
        tauriProvider: deps.tauriProvider,
        tracer: deps.tracer,
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
