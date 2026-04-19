import type { AppUI } from '@/shared/shell/AppUI';
import type { SidebarUI } from '@/shared/shell/SidebarUI';
import type { WindowUI } from '@/shared/shell/WindowUI';
import type { DownloadUI } from '@/features/downloads/ui/DownloadUI';
import type { SettingsUI } from '@/features/settings/ui/SettingsUI';
import type { ModuleSettingsUI } from '@/features/settings/ui/ModuleSettingsUI';
import type { MonitoringUI } from '@/features/monitoring/ui/MonitoringUI';
import type { ConsoleUI } from '@/features/console/ui/ConsoleUI';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { NavigationUI } from '@/infrastructure/navigation/NavigationUI';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { ModuleService } from '@/shared/services/ModuleService';
import type { WindowService } from '@/shared/services/WindowService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { CatalogService } from '@/shared/services/CatalogService';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { SoundService } from '@/shared/services/SoundService';
import type { UiStateStore } from '@/shared/services/state/UiStateStore';
import type { UISettingsService } from '@/shared/services/ui/UISettingsService';
import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { ModuleSettingsService } from '@/shared/services/modules/ModuleSettingsService';
import type { MonitoringService } from '@/features/monitoring/services/MonitoringService';
import type { ConsoleLogService } from '@/features/console/services/ConsoleLogService';
import type { SettingsService } from '@/features/settings/services/SettingsService';
import type { ChatController } from '@/features/chat/chat';
import type { ModulePlatformService } from '@/shared/services/ModulePlatformService';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { TemplateLoader } from '@/shared/services/TemplateLoader';
import type { EventBus } from '@/shared/services/EventBus';
import type { ErrorHandler } from '@/shared/services/ErrorHandler';
import type { StateManager } from '@/shared/services/StateManager';
import type { Particles } from '@/shared/shell/Particles';
import type { Core } from './init';
import { container } from './CoreContainer';

type LogBatch = { level: string; message: string }[];

type CoreServiceRegistrationBundle = {
    core: Core;
    tauriProvider: TauriProvider;
    tracer: LoggerService;
    stateStore: UiStateStore;
    uiSettings: UISettingsService;
    aiSettings: AISettingsService;
    moduleSettings: ModuleSettingsService;
    moduleService: ModuleService;
    modulePlatformService: ModulePlatformService;
    windowService: WindowService;
    i18n: I18nService;
    catalog: CatalogService;
    navigation: NavigationService;
    soundService: SoundService;
    monitoringService: MonitoringService;
    consoleLogService: ConsoleLogService;
    settingsService: SettingsService;
    chatController: ChatController;
    aiBridge: AIBridge;
};

type CoreUiRegistrationBundle = {
    appUI: AppUI;
    i18nUI: I18nUI;
    windowUI: WindowUI;
    navigationUI: NavigationUI;
    sidebarUI: SidebarUI;
    downloadUI: DownloadUI;
    settingsUI: SettingsUI;
    moduleSettingsUI: ModuleSettingsUI;
    monitoringUI: MonitoringUI;
    consoleUI: ConsoleUI;
    particles: Particles;
};

type CoreInfrastructureRegistrationBundle = {
    templateLoader: TemplateLoader;
    eventBus: EventBus;
    errorHandler: ErrorHandler;
    stateManager: StateManager;
};

type RegisterCoreContainerArgs = {
    services: CoreServiceRegistrationBundle;
    ui: CoreUiRegistrationBundle;
    infra: CoreInfrastructureRegistrationBundle;
};

type BindAIBridgeContextArgs = {
    aiBridge: AIBridge;
    tauriProvider: TauriProvider;
    aiSettings: AISettingsService;
    catalog: CatalogService;
    i18n: I18nService;
    settingsService: SettingsService;
    stateStore: UiStateStore;
    windowService: WindowService;
    chatController: ChatController;
    appUI: AppUI;
};

type DestroyCoreResourcesArgs = {
    deferredChatInitTimer: ReturnType<typeof setTimeout> | null;
    stateManager: StateManager;
    eventHandler: { destroy: () => void };
    chatController: ChatController;
    appUI: AppUI;
    settingsUI: SettingsUI;
    moduleSettingsUI: ModuleSettingsUI;
    downloadUI: DownloadUI;
    navigationUI: NavigationUI;
    windowUI: WindowUI;
    windowService: WindowService;
    moduleService: ModuleService;
    i18nUI: I18nUI;
    consoleUI: ConsoleUI;
    monitoringUI: MonitoringUI;
    monitoringService: MonitoringService;
    sidebarUI: SidebarUI;
    particles: Particles;
    soundService: SoundService;
    stateStore: UiStateStore;
    aiBridge: AIBridge;
    bridge: { destroy: () => void };
    errorHandler: ErrorHandler;
};

export function configureTracerTransport(
    tracer: LoggerService,
    tauriProvider: TauriProvider,
): void {
    const transport = async (logs: LogBatch): Promise<void> => {
        await tauriProvider.invoke('log_batch', { logs });
    };
    tracer.setFallbackTransport(transport);
    tracer.setTransport(transport);
}

export function bindAIBridgeContext(args: BindAIBridgeContextArgs): void {
    args.aiBridge.setContext({
        tauriProvider: args.tauriProvider,
        aiSettings: args.aiSettings,
        catalog: args.catalog,
        i18n: args.i18n,
        settingsService: args.settingsService,
        stateStore: args.stateStore,
        windowService: args.windowService,
        chatController: args.chatController,
        appUI: args.appUI,
    });
}

export function registerCoreContainer(args: RegisterCoreContainerArgs): void {
    container.registerServices(args.services);
    container.registerUI(args.ui);
    container.registerInfra(args.infra);
    container.lock();
}

export function destroyCoreResources(args: DestroyCoreResourcesArgs): void {
    if (args.deferredChatInitTimer !== null) {
        globalThis.clearTimeout(args.deferredChatInitTimer);
    }

    args.stateManager.destroy();
    args.eventHandler.destroy();
    args.chatController.destroy();
    args.appUI.destroy();
    args.settingsUI.destroy();
    args.moduleSettingsUI.destroy();
    args.downloadUI.destroy();
    args.navigationUI.destroy();
    args.windowUI.destroy();
    args.windowService.destroy();
    args.moduleService.destroy();
    args.i18nUI.destroy();
    args.consoleUI.destroy();
    args.monitoringUI.destroy();
    args.monitoringService.destroy();
    args.sidebarUI.destroy();
    args.particles.destroy();
    args.soundService.destroy();
    args.stateStore.destroy();
    args.aiBridge.destroy();
    args.bridge.destroy();
    args.errorHandler.destroy();
}
