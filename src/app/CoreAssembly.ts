import { GlobalBridge } from './bridge';
import { EventHandler } from './events';
import type { Core } from './init';
import { CoreLifecycleController, type CoreLifecycleDeps } from './CoreLifecycleController';
import { ErrorHandler } from '@/shared/services/ErrorHandler';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { CoreInfrastructure, CoreServices, CoreUI } from './CoreContainer';
import { StateManager } from '@/shared/services/StateManager';
import { createCoreUiBundle } from './CoreUiFactory';
import { configureCoreServices, createCoreServiceBundle } from './CoreServiceFactory';
import {
    bindAIBridgeContext,
    configureTracerTransport,
    registerCoreContainer,
} from './CoreComposition';
import { createClipboardReader, createClipboardWriter } from './CoreUiBridgeHelpers';
import { GlobalTextContextMenu } from '@/shared/shell/GlobalTextContextMenu';

type CoreAssemblyState = {
    isDestroyed: () => boolean;
};

type CreateCoreAssemblyArgs = {
    core: Core;
    tracer: LoggerService;
    state: CoreAssemblyState;
    globalShortcutKeydown: (e: KeyboardEvent) => void;
};

export type CoreAssembly = {
    services: CoreServices;
    ui: CoreUI;
    infra: CoreInfrastructure;
    lifecycleController: CoreLifecycleController;
};

type AssemblyParts = {
    services: CoreServices;
    ui: CoreUI;
    infra: CoreInfrastructure;
    bridge: GlobalBridge;
    eventHandler: EventHandler;
    globalTextContextMenu: GlobalTextContextMenu;
};

function createStateManager(args: {
    tracer: LoggerService;
    stateStore: CoreServices['stateStore'];
    windowService: CoreServices['windowService'];
}): StateManager {
    const stateManager = new StateManager(args.tracer);
    stateManager.register({
        name: 'ui-state',
        saveAsync: () => args.stateStore.saveAsync(),
        saveImmediate: () => args.stateStore.saveImmediate(),
    });
    stateManager.register({
        name: 'window-state',
        saveAsync: () => args.windowService.saveAsync(),
        saveImmediate: () => args.windowService.saveImmediate(),
    });
    stateManager.init();
    args.windowService.setBeforeCloseHook(() => stateManager.saveAllAsync());
    return stateManager;
}

export function createCoreAssembly(args: CreateCoreAssemblyArgs): CoreAssembly {
    const serviceBundle = createCoreServiceBundle(args.tracer);

    configureTracerTransport(args.tracer, serviceBundle.tauriProvider);
    args.tracer.debug(`AXELATE v${__APP_VERSION__}`);

    configureCoreServices({
        windowService: serviceBundle.windowService,
        navigation: serviceBundle.navigation,
        uiSettings: serviceBundle.uiSettings,
    });

    const bridge = new GlobalBridge({
        aiBridge: serviceBundle.aiBridge,
        tracer: args.tracer,
        moduleService: serviceBundle.moduleService,
        tauriProvider: serviceBundle.tauriProvider,
    });

    const ui = createCoreUiBundle({
        modulePlatformService: serviceBundle.modulePlatformService,
        navigation: serviceBundle.navigation,
        eventBus: serviceBundle.eventBus,
        catalog: serviceBundle.catalog,
        i18n: serviceBundle.i18n,
        tracer: args.tracer,
        stateStore: serviceBundle.stateStore,
        bridge,
        aiBridge: serviceBundle.aiBridge,
        windowService: serviceBundle.windowService,
        settingsService: serviceBundle.settingsService,
        uiSettings: serviceBundle.uiSettings,
        aiSettings: serviceBundle.aiSettings,
        soundService: serviceBundle.soundService,
        tauriProvider: serviceBundle.tauriProvider,
        monitoringService: serviceBundle.monitoringService,
        consoleLogService: serviceBundle.consoleLogService,
    });

    const eventHandler = new EventHandler({
        appUI: ui.appUI,
        chatController: ui.chatController,
        consoleUI: ui.consoleUI,
        downloadUI: ui.downloadUI,
        i18nUI: ui.i18nUI,
        navigationUI: ui.navigationUI,
        moduleSettingsUI: ui.moduleSettingsUI,
        tracer: args.tracer,
        windowService: serviceBundle.windowService,
        windowUI: ui.windowUI,
    });
    const globalTextContextMenu = new GlobalTextContextMenu({
        translate: (key, fallback) => serviceBundle.i18n.t(key, fallback),
        copyText: createClipboardWriter(serviceBundle.tauriProvider),
        readClipboardText: createClipboardReader(serviceBundle.tauriProvider),
        tracer: args.tracer,
    });

    bindAIBridgeContext({
        aiBridge: serviceBundle.aiBridge,
        tauriProvider: serviceBundle.tauriProvider,
        aiSettings: serviceBundle.aiSettings,
        catalog: serviceBundle.catalog,
        i18n: serviceBundle.i18n,
        settingsService: serviceBundle.settingsService,
        stateStore: serviceBundle.stateStore,
        windowService: serviceBundle.windowService,
        chatController: ui.chatController,
        appUI: ui.appUI,
    });

    const stateManager = createStateManager({
        tracer: args.tracer,
        stateStore: serviceBundle.stateStore,
        windowService: serviceBundle.windowService,
    });
    const errorHandler = new ErrorHandler({
        eventBus: serviceBundle.eventBus,
        tracer: args.tracer,
    });
    errorHandler.init();

    const services: CoreServices = {
        core: args.core,
        tauriProvider: serviceBundle.tauriProvider,
        tracer: args.tracer,
        stateStore: serviceBundle.stateStore,
        uiSettings: serviceBundle.uiSettings,
        aiSettings: serviceBundle.aiSettings,
        moduleSettings: serviceBundle.moduleSettings,
        moduleService: serviceBundle.moduleService,
        modulePlatformService: serviceBundle.modulePlatformService,
        windowService: serviceBundle.windowService,
        i18n: serviceBundle.i18n,
        catalog: serviceBundle.catalog,
        navigation: serviceBundle.navigation,
        soundService: serviceBundle.soundService,
        monitoringService: serviceBundle.monitoringService,
        consoleLogService: serviceBundle.consoleLogService,
        settingsService: serviceBundle.settingsService,
        chatController: ui.chatController,
        aiBridge: serviceBundle.aiBridge,
    };
    const infra: CoreInfrastructure = {
        templateLoader: serviceBundle.templateLoader,
        eventBus: serviceBundle.eventBus,
        errorHandler,
        stateManager,
    };

    registerCoreContainer({ services, ui, infra });

    const lifecycleController = new CoreLifecycleController(
        createLifecycleDeps(
            { services, ui, infra, bridge, eventHandler, globalTextContextMenu },
            {
                state: args.state,
                globalShortcutKeydown: args.globalShortcutKeydown,
            },
        ),
    );

    return {
        services,
        ui,
        infra,
        lifecycleController,
    };
}

function createLifecycleDeps(
    parts: AssemblyParts,
    runtime: Pick<CreateCoreAssemblyArgs, 'state' | 'globalShortcutKeydown'>,
): CoreLifecycleDeps {
    const { services, ui, infra, bridge, eventHandler } = parts;
    return {
        bootstrap: {
            aiBridge: services.aiBridge,
            tauriProvider: services.tauriProvider,
            tracer: services.tracer,
            templateLoader: infra.templateLoader,
            stateStore: services.stateStore,
            windowService: services.windowService,
            windowUI: ui.windowUI,
            i18n: services.i18n,
            i18nUI: ui.i18nUI,
            catalog: services.catalog,
            navigation: services.navigation,
            navigationUI: ui.navigationUI,
            chatController: services.chatController,
            bridge,
            eventHandler,
        },
        immediateUi: {
            navigation: services.navigation,
            navigationUI: ui.navigationUI,
            downloadUI: ui.downloadUI,
            moduleService: services.moduleService,
            sidebarUI: ui.sidebarUI,
        },
        deferredUi: {
            settingsService: services.settingsService,
            monitoringUI: ui.monitoringUI,
            settingsUI: ui.settingsUI,
            moduleSettingsUI: ui.moduleSettingsUI,
            i18nUI: ui.i18nUI,
            consoleUI: ui.consoleUI,
            tracer: services.tracer,
            moduleSettings: services.moduleSettings,
            catalog: services.catalog,
            appUI: ui.appUI,
            aiBridge: services.aiBridge,
        },
        backendSelection: {
            tauriProvider: services.tauriProvider,
            stateStore: services.stateStore,
            appUI: ui.appUI,
        },
        disposables: {
            stateManager: infra.stateManager,
            eventHandler,
            chatController: services.chatController,
            appUI: ui.appUI,
            settingsUI: ui.settingsUI,
            moduleSettingsUI: ui.moduleSettingsUI,
            downloadUI: ui.downloadUI,
            navigationUI: ui.navigationUI,
            windowUI: ui.windowUI,
            windowService: services.windowService,
            moduleService: services.moduleService,
            i18nUI: ui.i18nUI,
            consoleUI: ui.consoleUI,
            monitoringUI: ui.monitoringUI,
            monitoringService: services.monitoringService,
            sidebarUI: ui.sidebarUI,
            particles: ui.particles,
            soundService: services.soundService,
            stateStore: services.stateStore,
            aiBridge: services.aiBridge,
            bridge,
            errorHandler: infra.errorHandler,
            globalTextContextMenu: parts.globalTextContextMenu,
        },
        state: runtime.state,
        globalShortcutKeydown: runtime.globalShortcutKeydown,
    };
}
