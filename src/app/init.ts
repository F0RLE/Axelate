import '@/styles/main.css';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { ModuleService } from '@/shared/services/ModuleService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { WindowService } from '@/shared/services/WindowService';
import type { WindowUI } from '@/shared/shell/WindowUI';
import type { CatalogService } from '@/shared/services/CatalogService';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { NavigationUI } from '@/infrastructure/navigation/NavigationUI';
import type { SidebarUI } from '@/shared/shell/SidebarUI';
import type { AppUI } from '@/shared/shell/AppUI';
import type { DownloadUI } from '@/features/downloads/ui/DownloadUI';
import type { SoundService } from '@/shared/services/SoundService';
import { tracer, type LoggerService } from '@/infrastructure/logging/LoggerService';
import type { TemplateLoader } from '@/shared/services/TemplateLoader';
import { GlobalBridge } from './bridge';
import { EventHandler } from './events';
import { CoreLifecycleController } from './CoreLifecycleController';
import type { UiStateStore } from '@/shared/services/state/UiStateStore';
import type { UISettingsService } from '@/shared/services/ui/UISettingsService';
import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { ModuleSettingsService } from '@/shared/services/modules/ModuleSettingsService';
import type { Particles } from '@/shared/shell/Particles';
import type { MonitoringService } from '@/features/monitoring/services/MonitoringService';
import type { MonitoringUI } from '@/features/monitoring/ui/MonitoringUI';
import type { ConsoleLogService } from '@/features/console/services/ConsoleLogService';
import type { ConsoleUI } from '@/features/console/ui/ConsoleUI';
import type { SettingsService } from '@/features/settings/services/SettingsService';
import type { SettingsUI } from '@/features/settings/ui/SettingsUI';
import type { ModuleSettingsUI } from '@/features/settings/ui/ModuleSettingsUI';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { ChatController } from '@/features/chat/chat';
import type { ModulePlatformService } from '@/shared/services/ModulePlatformService';
import type { EventBus } from '@/shared/services/EventBus';
import { ErrorHandler } from '@/shared/services/ErrorHandler';
import type { StateManager } from '@/shared/services/StateManager';
import { bindCoreEntry } from './CoreEntry';
import { createCoreUiBundle, createStateManager } from './CoreUiFactory';
import { configureCoreServices, createCoreServiceBundle } from './CoreServiceFactory';
import {
    bindAIBridgeContext,
    configureTracerTransport,
    registerCoreContainer,
} from './CoreComposition';

export class Core {
    // Services - Made public for EventHandler and GlobalBridge
    public readonly tauriProvider: TauriProvider;
    public readonly tracer: LoggerService;
    public readonly i18n: I18nService;
    public readonly windowService: WindowService;
    public readonly moduleService: ModuleService;
    public readonly catalog: CatalogService;
    public readonly navigation: NavigationService;
    public readonly soundService: SoundService;
    public readonly stateStore: UiStateStore;
    public readonly uiSettings: UISettingsService;
    public readonly aiSettings: AISettingsService;
    public readonly moduleSettings: ModuleSettingsService;
    public readonly particles: Particles;
    public readonly monitoringService: MonitoringService;
    public readonly monitoringUI: MonitoringUI;
    public readonly consoleLogService: ConsoleLogService;
    public readonly consoleUI: ConsoleUI;
    public readonly settingsService: SettingsService;
    public readonly chatController: ChatController;
    public readonly modulePlatformService: ModulePlatformService;
    public readonly aiBridge: AIBridge;
    public readonly stateManager: StateManager;
    public readonly errorHandler: ErrorHandler;
    public readonly templateLoader: TemplateLoader;

    // UI
    public readonly appUI: AppUI;
    public readonly i18nUI: I18nUI;
    public readonly windowUI: WindowUI;
    public readonly navigationUI: NavigationUI;
    public readonly sidebarUI: SidebarUI;
    public readonly downloadUI: DownloadUI;
    public readonly settingsUI: SettingsUI;
    public readonly moduleSettingsUI: ModuleSettingsUI;
    public readonly eventBus: EventBus;

    private readonly _bridge: GlobalBridge;
    private readonly _eventHandler: EventHandler;
    private readonly _lifecycleController: CoreLifecycleController;
    private _isDestroyed = false;
    private _isInitialized = false;
    private _initPromise: Promise<void> | null = null;
    private readonly _boundGlobalShortcutKeydown = (e: KeyboardEvent) => {
        const forbiddenKeys = ['F3', 'F7', 'F1'];
        if (forbiddenKeys.includes(e.key)) {
            e.preventDefault();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && ['f', 'p', 's'].includes(e.key.toLowerCase())) {
            e.preventDefault();
        }
    };

    constructor() {
        // Initialize base services following Section 16 patterns
        this.tracer = tracer;
        this.tracer.init();

        const services = createCoreServiceBundle(this.tracer);
        this.tauriProvider = services.tauriProvider;
        this.eventBus = services.eventBus;
        this.templateLoader = services.templateLoader;
        this.stateStore = services.stateStore;
        this.uiSettings = services.uiSettings;
        this.aiSettings = services.aiSettings;
        this.moduleSettings = services.moduleSettings;
        this.aiBridge = services.aiBridge;
        this.moduleService = services.moduleService;
        this.modulePlatformService = services.modulePlatformService;
        this.windowService = services.windowService;
        this.i18n = services.i18n;
        this.catalog = services.catalog;
        this.navigation = services.navigation;
        this.soundService = services.soundService;
        this.monitoringService = services.monitoringService;
        this.consoleLogService = services.consoleLogService;
        this.settingsService = services.settingsService;

        // Wire transport so tracer uses TauriProvider instead of raw __TAURI__ (§4.1)
        configureTracerTransport(this.tracer, this.tauriProvider);
        this.tracer.info(`AXELATE v${__APP_VERSION__}`);

        configureCoreServices({
            windowService: this.windowService,
            navigation: this.navigation,
            uiSettings: this.uiSettings,
        });

        // 3. Init bridge before UI factories that depend on launcher actions
        this._bridge = new GlobalBridge({
            aiSettings: this.aiSettings,
            aiBridge: this.aiBridge,
            catalog: this.catalog,
            tracer: this.tracer,
            moduleService: this.moduleService,
            tauriProvider: this.tauriProvider,
        });

        const ui = createCoreUiBundle({
            modulePlatformService: this.modulePlatformService,
            navigation: this.navigation,
            eventBus: this.eventBus,
            catalog: this.catalog,
            i18n: this.i18n,
            tracer: this.tracer,
            stateStore: this.stateStore,
            bridge: this._bridge,
            aiBridge: this.aiBridge,
            windowService: this.windowService,
            settingsService: this.settingsService,
            uiSettings: this.uiSettings,
            aiSettings: this.aiSettings,
            soundService: this.soundService,
            tauriProvider: this.tauriProvider,
            monitoringService: this.monitoringService,
            consoleLogService: this.consoleLogService,
        });
        this.appUI = ui.appUI;
        this.i18nUI = ui.i18nUI;
        this.windowUI = ui.windowUI;
        this.navigationUI = ui.navigationUI;
        this.sidebarUI = ui.sidebarUI;
        this.downloadUI = ui.downloadUI;
        this.settingsUI = ui.settingsUI;
        this.moduleSettingsUI = ui.moduleSettingsUI;
        this.particles = ui.particles;
        this.monitoringUI = ui.monitoringUI;
        this.consoleUI = ui.consoleUI;
        this.chatController = ui.chatController;

        // 5. Init Event Handler
        this._eventHandler = new EventHandler({
            appUI: this.appUI,
            chatController: this.chatController,
            consoleUI: this.consoleUI,
            downloadUI: this.downloadUI,
            i18nUI: this.i18nUI,
            navigationUI: this.navigationUI,
            moduleSettingsUI: this.moduleSettingsUI,
            tracer: this.tracer,
            windowService: this.windowService,
            windowUI: this.windowUI,
        });

        // Inject Core into Service Singletons (Section 16.2)
        bindAIBridgeContext({
            aiBridge: this.aiBridge,
            tauriProvider: this.tauriProvider,
            aiSettings: this.aiSettings,
            catalog: this.catalog,
            i18n: this.i18n,
            settingsService: this.settingsService,
            stateStore: this.stateStore,
            windowService: this.windowService,
            chatController: this.chatController,
            appUI: this.appUI,
        });

        // StateManager — centralized persistence coordinator
        this.stateManager = createStateManager({
            tracer: this.tracer,
            stateStore: this.stateStore,
            windowService: this.windowService,
        });
        this.errorHandler = new ErrorHandler({
            eventBus: this.eventBus,
            tracer: this.tracer,
        });
        this.errorHandler.init();

        // Register all services in DI container (replaces globalThis pollution)
        this._registerContainer();
        this._lifecycleController = new CoreLifecycleController({
            tauriProvider: this.tauriProvider,
            tracer: this.tracer,
            templateLoader: this.templateLoader,
            stateStore: this.stateStore,
            windowService: this.windowService,
            windowUI: this.windowUI,
            i18n: this.i18n,
            i18nUI: this.i18nUI,
            catalog: this.catalog,
            navigation: this.navigation,
            navigationUI: this.navigationUI,
            downloadUI: this.downloadUI,
            moduleService: this.moduleService,
            sidebarUI: this.sidebarUI,
            settingsService: this.settingsService,
            monitoringUI: this.monitoringUI,
            settingsUI: this.settingsUI,
            moduleSettingsUI: this.moduleSettingsUI,
            consoleUI: this.consoleUI,
            moduleSettings: this.moduleSettings,
            aiSettings: this.aiSettings,
            appUI: this.appUI,
            aiBridge: this.aiBridge,
            chatController: this.chatController,
            stateManager: this.stateManager,
            eventHandler: this._eventHandler,
            bridge: this._bridge,
            errorHandler: this.errorHandler,
            monitoringService: this.monitoringService,
            particles: this.particles,
            soundService: this.soundService,
            state: {
                isDestroyed: () => this._isDestroyed,
            },
            globalShortcutKeydown: this._boundGlobalShortcutKeydown,
        });
    }

    /**
     * Executes the core initialization sequence with hardened survival logic.
     */
    public async init(): Promise<void> {
        if (this._isInitialized) return;
        if (this._initPromise !== null) {
            await this._initPromise;
            return;
        }

        this._initPromise = this._runInit();
        try {
            await this._initPromise;
            this._isInitialized = true;
        } finally {
            this._initPromise = null;
        }
    }

    private async _runInit(): Promise<void> {
        await this._lifecycleController.runInit();
    }

    private _registerContainer(): void {
        registerCoreContainer({
            services: {
                core: this,
                tauriProvider: this.tauriProvider,
                tracer: this.tracer,
                stateStore: this.stateStore,
                uiSettings: this.uiSettings,
                aiSettings: this.aiSettings,
                moduleSettings: this.moduleSettings,
                moduleService: this.moduleService,
                modulePlatformService: this.modulePlatformService,
                windowService: this.windowService,
                i18n: this.i18n,
                catalog: this.catalog,
                navigation: this.navigation,
                soundService: this.soundService,
                monitoringService: this.monitoringService,
                consoleLogService: this.consoleLogService,
                settingsService: this.settingsService,
                chatController: this.chatController,
                aiBridge: this.aiBridge,
            },
            ui: {
                appUI: this.appUI,
                i18nUI: this.i18nUI,
                windowUI: this.windowUI,
                navigationUI: this.navigationUI,
                sidebarUI: this.sidebarUI,
                downloadUI: this.downloadUI,
                settingsUI: this.settingsUI,
                moduleSettingsUI: this.moduleSettingsUI,
                monitoringUI: this.monitoringUI,
                consoleUI: this.consoleUI,
                particles: this.particles,
            },
            infra: {
                templateLoader: this.templateLoader,
                eventBus: this.eventBus,
                errorHandler: this.errorHandler,
                stateManager: this.stateManager,
            },
        });
    }

    public destroy(): void {
        if (this._isDestroyed) return;
        this._isDestroyed = true;
        this._isInitialized = false;
        this._initPromise = null;
        this._lifecycleController.destroy(this._boundGlobalShortcutKeydown);
    }
}
bindCoreEntry(() => new Core(), tracer);
