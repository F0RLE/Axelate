import '@/styles/main.css';
import { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import { ModuleService } from '@/shared/services/ModuleService';
import { I18nService } from '@/infrastructure/i18n/I18nService';
import { I18nUI } from '@/infrastructure/i18n/I18nUI';
import { WindowService } from '@/shared/services/WindowService';
import { WindowUI } from '@/shared/shell/WindowUI';
import { CatalogService } from '@/shared/services/CatalogService';
import { NavigationService } from '@/infrastructure/navigation/NavigationService';
import { NavigationUI } from '@/infrastructure/navigation/NavigationUI';
import { SidebarUI } from '@/shared/shell/SidebarUI';
import { AppUI } from '@/shared/shell/AppUI';
import { DownloadUI } from '@/features/downloads/ui/DownloadUI';
import { SoundService } from '@/shared/services/SoundService';
import { tracer, type LoggerService } from '@/infrastructure/logging/LoggerService';
import { templateLoader } from '@/shared/services/TemplateLoader';
import { APP_PAGES } from '@/shared/config/AppPages';
import type { IApp, IBootstrapData } from '@/shared/types/coreTypes';
import { GlobalBridge } from './bridge';
import { EventHandler } from './events';
import { UiStateStore } from '@/shared/services/state/UiStateStore';
import { UISettingsService } from '@/shared/services/ui/UISettingsService';
import { AISettingsService } from '@/shared/services/ai/AISettingsService';
import { ModuleSettingsService } from '@/shared/services/modules/ModuleSettingsService';
import { Particles } from '@/shared/shell/Particles';
import { MonitoringService } from '@/features/monitoring/services/MonitoringService';
import { MonitoringUI } from '@/features/monitoring/ui/MonitoringUI';
import { DebugService } from '@/features/debug/services/DebugService';
import { DebugUI } from '@/features/debug/ui/DebugUI';
import { SettingsService } from '@/features/settings/services/SettingsService';
import { SettingsUI } from '@/features/settings/ui/SettingsUI';
import { ModuleSettingsUI } from '@/features/settings/ui/ModuleSettingsUI';
import { aiBridge } from '@/features/ai/services/AIBridge';
import { ChatController } from '@/features/chat/chat';
import { ModulePlatformService } from '@/shared/services/ModulePlatformService';
import { container } from './CoreContainer';
import { eventBus } from '@/shared/services/EventBus';
import { errorHandler } from '@/shared/services/ErrorHandler';
import { StateManager } from '@/shared/services/StateManager';

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
    public readonly debugService: DebugService;
    public readonly debugUI: DebugUI;
    public readonly settingsService: SettingsService;
    public readonly chatController: ChatController;
    public readonly modulePlatformService: ModulePlatformService;
    public readonly stateManager: StateManager;

    // UI
    public readonly appUI: AppUI;
    public readonly i18nUI: I18nUI;
    public readonly windowUI: WindowUI;
    public readonly navigationUI: NavigationUI;
    public readonly sidebarUI: SidebarUI;
    public readonly downloadUI: DownloadUI;
    public readonly settingsUI: SettingsUI;
    public readonly moduleSettingsUI: ModuleSettingsUI;

    private readonly _bridge: GlobalBridge;
    private readonly _eventHandler: EventHandler;
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

    private static readonly _SPLASH_TIMEOUT_MS = 500;
    constructor() {
        // Initialize base services following Section 16 patterns
        this.tauriProvider = new TauriProvider();
        this.tauriProvider.init();
        this.tracer = tracer;
        this.tracer.init();
        // Wire transport so tracer uses TauriProvider instead of raw __TAURI__ (§4.1)
        this.tracer.setTransport((logs) => this.tauriProvider.invoke('log_batch', { logs }));

        this.tracer.info(`AXELATE v${__APP_VERSION__}`);

        // 2. Init Core Services
        this.stateStore = new UiStateStore(this.tauriProvider);
        this.uiSettings = new UISettingsService(this.stateStore);
        this.aiSettings = new AISettingsService(this.stateStore);
        this.moduleSettings = new ModuleSettingsService(this.stateStore);
        this.moduleService = new ModuleService(this.tauriProvider);
        this.modulePlatformService = new ModulePlatformService(() => this.moduleService);
        this.windowService = new WindowService(this.tauriProvider);
        this.i18n = new I18nService(this.tauriProvider);
        this.catalog = new CatalogService(this.tauriProvider);
        this.navigation = new NavigationService();
        this.soundService = new SoundService();
        templateLoader.init();

        // Inject StateService into WindowService (Dependency Injection) to ensure zoom sync
        // works immediately, avoiding startup race conditions.
        this.windowService.setUISettingsService(this.uiSettings);
        this.navigation.setUISettingsService(this.uiSettings);

        this.monitoringService = new MonitoringService(this.tauriProvider);
        this.debugService = new DebugService(this.tauriProvider);
        this.settingsService = new SettingsService(this.tauriProvider);

        // 3. Init UI Handlers
        this.appUI = new AppUI(this.modulePlatformService, this.navigation);
        this.i18nUI = new I18nUI(this.i18n);
        this.windowUI = new WindowUI(this.windowService, this.uiSettings, this.soundService);
        this.navigationUI = new NavigationUI(this.navigation, this.soundService);
        this.sidebarUI = new SidebarUI(this.uiSettings, this.soundService);
        this.downloadUI = new DownloadUI(this.i18n);
        this.downloadUI.setOnCancel((moduleId: string) => {
            void this.modulePlatformService.cancelDownload(moduleId);
        });
        this.settingsUI = new SettingsUI(
            this.settingsService,
            this.uiSettings,
            this.aiSettings,
            this.i18nUI,
            this.tauriProvider,
            this.navigation,
        );
        this.moduleSettingsUI = new ModuleSettingsUI(
            this.settingsService,
            this.uiSettings,
            this.aiSettings,
            this.i18nUI,
            this.tauriProvider,
            this.navigation,
        );
        this.particles = new Particles();
        this.monitoringUI = new MonitoringUI(this.monitoringService);
        this.debugUI = new DebugUI(this.debugService);

        // 4. Init Event Handler and Bridge
        this._bridge = new GlobalBridge(this);

        this._eventHandler = new EventHandler(this);

        // Inject Core into Service Singletons (Section 16.2)
        aiBridge.setCore(this);

        this.chatController = new ChatController(aiBridge, this.i18n, this.soundService);

        // StateManager — centralized persistence coordinator
        this.stateManager = new StateManager();
        this.stateManager.register({
            name: 'ui-state',
            saveAsync: () => this.stateStore.saveAsync(),
            saveImmediate: () => this.stateStore.saveImmediate(),
        });
        this.stateManager.register({
            name: 'window-state',
            saveAsync: () => this.windowService.saveAsync(),
            saveImmediate: () => this.windowService.saveImmediate(),
        });
        this.stateManager.init();

        // Register all services in DI container (replaces globalThis pollution)
        container.registerServices({
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
            debugService: this.debugService,
            settingsService: this.settingsService,
            chatController: this.chatController,
        });

        container.registerUI({
            appUI: this.appUI,
            i18nUI: this.i18nUI,
            windowUI: this.windowUI,
            navigationUI: this.navigationUI,
            sidebarUI: this.sidebarUI,
            downloadUI: this.downloadUI,
            settingsUI: this.settingsUI,
            moduleSettingsUI: this.moduleSettingsUI,
            monitoringUI: this.monitoringUI,
            debugUI: this.debugUI,
            particles: this.particles,
        });

        container.registerInfra({
            templateLoader,
            eventBus,
            errorHandler,
            stateManager: this.stateManager,
        });

        container.lock();
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
        this.tracer.debug('[Core] Init sequence started.');

        this._bridge.init();
        this._eventHandler.init();
        this.chatController.init();

        // 1. Emergency Safety Timeout (Guarantee window appears + splash disappears)
        const safetyTimeout = setTimeout(() => {
            this.tracer.warn('[Core] Emergency bootstrap timeout triggered! Forcing UI reveal.');
            void this.windowService.show();
            this.windowUI.hideSplashScreen();
        }, 12000);

        try {
            // 3. Fetch Bootstrap Data
            let bootstrapData: IBootstrapData | null = null;
            bootstrapData = await this._fetchBootstrapData();

            // 4. Critical Service hydration
            const pagePromises = APP_PAGES.map((page) =>
                templateLoader.loadAndInject(`pages/${page.id}`, `page-${page.id}`),
            );

            const templateLoadPromise = Promise.all([
                templateLoader.loadAndInject('components/sidebar', 'sidebar'),
                ...pagePromises,
            ]).catch((e: unknown) => {
                this.tracer.error(`[Core] Template loading failed: ${String(e)}`);
            });

            if (bootstrapData === null) {
                await Promise.all([this.stateStore.loadState(), templateLoadPromise]);
                await this.windowService.init();
                this.windowUI.init();
                await this.i18n.init();
            } else {
                this.stateStore.setState(bootstrapData.uiState);
                try {
                    await this.windowService.init(
                        bootstrapData.windowConfig,
                        bootstrapData.initialZoom,
                    );
                    this.windowUI.init();
                    await this.i18n.init(bootstrapData.systemLanguage);
                } catch (e) {
                    this.tracer.warn(`[Core] Fast-path init failed: ${String(e)}`);
                }
                await templateLoadPromise;
            }

            this.i18nUI.applyTranslations();
            const win = globalThis as unknown as Window;
            win.uiState = this.stateStore as unknown as Window['uiState'];

            this.navigation.refreshFromUiState();
            const currentPage = this.navigation.getCurrentPage();
            await this.navigationUI.showPage(
                currentPage !== undefined && currentPage !== '' ? currentPage : 'home',
                null,
                true,
            );

            // 5. Show Window (immediately if ready)
            await this.windowService.show();

            // 6. Init Remaining Services (parallelized — no inter-dependencies)
            this.navigationUI.init();
            this.downloadUI.init();

            await this.settingsService.loadSettings();

            await Promise.all([
                this.moduleService.init(),
                this.sidebarUI.init(),
                this.settingsUI.init(),
                this.moduleSettingsUI.init(),
                this.monitoringUI.init(),
                aiBridge.init(),
                this.catalog.loadCatalog(),
            ]);

            // 7. Post-catalog restore (needs catalog data)
            this._restoreSelectedModules();
            this.i18nUI.applyTranslations();

            this.debugUI.init();
        } catch (e) {
            this.tracer.error(`[Core] Critical bootstrap failure: ${String(e)}`);
            throw e;
        } finally {
            clearTimeout(safetyTimeout);
        }

        this._initGlobalShortcuts();

        // 8. Controlled Reveal - Sync with CSS
        this.tracer.debug('[Core] App Ready. Hiding splash...');

        // Wait for splash animation (min 2s)
        await new Promise((r) => setTimeout(r, Core._SPLASH_TIMEOUT_MS));

        // Trigger Fade Out (hideSplashScreen also reveals sidebar/header/main-area)
        this.windowUI.hideSplashScreen();

        this.tracer.info('[Core] Ready.');
    }

    public destroy(): void {
        if (this._isDestroyed) return;
        this._isDestroyed = true;
        this._isInitialized = false;
        this._initPromise = null;

        // StateManager handles all persistence saves (beforeunload + visibilitychange)
        this.stateManager.destroy();

        globalThis.removeEventListener('keydown', this._boundGlobalShortcutKeydown);
        this._eventHandler.destroy();
        this.chatController.destroy();
        this.appUI.destroy();
        this.settingsUI.destroy();
        this.moduleSettingsUI.destroy();
        this.downloadUI.destroy();
        this.navigationUI.destroy();
        this.windowUI.destroy();
        this.windowService.destroy();
        this.moduleService.destroy();
        this.i18nUI.destroy();
        this.debugUI.destroy();
        this.monitoringUI.destroy();
        this.monitoringService.destroy();
        this.sidebarUI.destroy();
        this.particles.destroy();
        this.soundService.destroy();
        this.stateStore.destroy();
        aiBridge.destroy();
        this._bridge.destroy();
    }

    /**
     * Prevents browser default shortcuts that conflict with app UX.
     */
    private _initGlobalShortcuts(): void {
        globalThis.addEventListener('keydown', this._boundGlobalShortcutKeydown);
    }

    /**
     * Restores module selection from state.
     * Each AI capability slot ('ai_text', 'ai_image') is stored independently.
     */
    private _restoreSelectedModules(): void {
        this.tracer.debug('[Core] Restoring selected modules...');
        const selected = this.moduleSettings.getSelectedModules();

        // Restore AI slots independently (compound keys)
        for (const capability of ['ai_text', 'ai_image'] as const) {
            this._restoreCategorySelection(capability, selected[capability]);
        }
        // Restore service slots
        this._restoreCategorySelection('services', selected['services']);
    }

    private _restoreCategorySelection(
        category: string,
        catSelection: { id?: string; version?: string } | undefined,
    ): void {
        if (catSelection === undefined) return;

        let savedAppId = catSelection.id ?? '';

        // Fallback: for text slot, check legacy 'ai' key and last_active_provider
        if (category === 'ai_text' && savedAppId === '') {
            savedAppId =
                (this.moduleSettings.getSelectedModules()['ai'] as { id?: string } | undefined)
                    ?.id ??
                this.aiSettings.getLastActiveProvider() ??
                '';
        }

        if (savedAppId === '') return;

        // Catalog uses raw category ('ai' for both text/image slots, 'services' for services)
        const rawCategory = category.startsWith('ai') ? 'ai' : category;
        const list = globalThis.getCatalogCategory(rawCategory);
        const fullApp = list.find((a: IApp) => a.id === savedAppId);

        if (fullApp !== undefined) {
            // Pass compound category so AppUI stores under correct slot key
            this.appUI.updateModuleCard(category, fullApp);

            // Auto-start AI provider only for text slot (one provider at a time for now)
            if (category === 'ai_text') {
                this.tracer.info(`[Core] Auto-starting saved AI provider: ${savedAppId}`);
                void aiBridge.startProvider(savedAppId);
            }
        }
    }

    /**
     * Fetches bootstrap data with a timeout guard.
     */
    private async _fetchBootstrapData(): Promise<IBootstrapData | null> {
        if (!this.tauriProvider.isTauri()) return null;

        try {
            const bootstrapPromise =
                this.tauriProvider.invoke<IBootstrapData>('get_app_bootstrap_data');
            const timeoutPromise = new Promise<null>((r) =>
                setTimeout(() => {
                    r(null);
                }, 5000),
            );

            const result = await Promise.race([bootstrapPromise, timeoutPromise]);
            this.tracer.debug(
                `[Core] Bootstrap result: ${result === null ? 'Timed out' : 'Data fetched'}`,
            );
            return result;
        } catch (e) {
            this.tracer.warn(`[Core] Bootstrap IPC failed: ${String(e)}`);
            return null;
        }
    }
}

type CoreBootWindow = Window & {
    core?: Core;
    __axelateCoreInitialized__?: boolean;
    __axelateCoreInstance__?: Core | null;
    __axelateCoreBootBound__?: boolean;
    __axelateCoreBeforeUnloadBound__?: boolean;
};

function bootCoreOnce(): void {
    const win = globalThis as unknown as CoreBootWindow;

    if (win.__axelateCoreInstance__ !== null && win.__axelateCoreInstance__ !== undefined) {
        tracer.warn('[Core] Double init blocked (global singleton already active).');
        return;
    }

    if (win.__axelateCoreInitialized__ === true) {
        tracer.warn('[Core] Recovering from stale init flag without active core instance.');
        win.__axelateCoreInitialized__ = false;
    }

    try {
        const coreInstance = new Core();
        win.__axelateCoreInitialized__ = true;
        win.__axelateCoreInstance__ = coreInstance;
        win.core = coreInstance;

        coreInstance.init().catch((e: unknown) => {
            tracer.error(`[Core] Boot failed: ${String(e)}`);
        });
    } catch (e: unknown) {
        win.__axelateCoreInitialized__ = false;
        win.__axelateCoreInstance__ = null;
        delete (win as unknown as Record<string, unknown>)['core'];
        tracer.error(`[Core] Constructor boot failed: ${String(e)}`);
        throw e;
    }
}

const coreBootWindow = globalThis as unknown as CoreBootWindow;

if (document.readyState === 'loading') {
    if (coreBootWindow.__axelateCoreBootBound__ !== true) {
        coreBootWindow.__axelateCoreBootBound__ = true;
        document.addEventListener(
            'DOMContentLoaded',
            () => {
                bootCoreOnce();
            },
            { once: true },
        );
    }
} else {
    bootCoreOnce();
}

if (coreBootWindow.__axelateCoreBeforeUnloadBound__ !== true) {
    coreBootWindow.__axelateCoreBeforeUnloadBound__ = true;
    globalThis.addEventListener('beforeunload', () => {
        const win = globalThis as unknown as CoreBootWindow;
        win.__axelateCoreInstance__?.destroy();
        win.__axelateCoreInstance__ = null;
        win.__axelateCoreInitialized__ = false;
        delete (win as unknown as Record<string, unknown>)['core'];
    });
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        const win = globalThis as unknown as CoreBootWindow;
        win.__axelateCoreInstance__?.destroy();
        win.__axelateCoreInstance__ = null;
        win.__axelateCoreInitialized__ = false;
        win.__axelateCoreBootBound__ = false;
        delete (win as unknown as Record<string, unknown>)['core'];
    });
}
