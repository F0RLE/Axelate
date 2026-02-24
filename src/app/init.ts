import '@/styles/main.css';
import { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import { ModuleService } from '@/shared/services/ModuleService';
import { I18nService } from '@/infrastructure/i18n/I18nService';
import { I18nUI } from '@/infrastructure/i18n/I18nUI';
import { WindowService } from '@/shared/services/WindowService';
import { WindowUI } from '@/shared/components/WindowUI';
import { CatalogService } from '@/shared/services/CatalogService';
import { NavigationService } from '@/infrastructure/navigation/NavigationService';
import { NavigationUI } from '@/infrastructure/navigation/NavigationUI';
import { SidebarUI } from '@/shared/components/SidebarUI';
import { AppUI } from '@/shared/components/AppUI';
import { DownloadUI } from '@/features/downloads/ui/DownloadUI';
import { SoundService } from '@/shared/services/SoundService';
import { logger, type LoggerService } from '@/infrastructure/logging/LoggerService';
import { templateLoader } from '@/shared/services/TemplateLoader';
import type { IApp, IBootstrapData } from '@/shared/types/coreTypes';
import { GlobalBridge } from './bridge';
import { EventHandler } from './events';
import { UiStateStore } from '@/shared/services/state/UiStateStore';
import { UISettingsService } from '@/shared/services/ui/UISettingsService';
import { AISettingsService } from '@/shared/services/ai/AISettingsService';
import { DownloadSettingsService } from '@/shared/services/downloads/DownloadSettingsService';
import { ModuleSettingsService } from '@/shared/services/modules/ModuleSettingsService';
import { Particles } from '@/shared/components/Particles';
import { MonitoringService } from '@/features/monitoring/services/MonitoringService';
import { MonitoringUI } from '@/features/monitoring/ui/MonitoringUI';
import { DebugService } from '@/features/debug/services/DebugService';
import { DebugUI } from '@/features/debug/ui/DebugUI';
import { SettingsService } from '@/features/settings/services/SettingsService';
import { SettingsUI } from '@/features/settings/ui/SettingsUI';
import { aiBridge } from '@/features/ai/services/AIBridge';
import { ChatController } from '@/features/chat/chat';
import { ModulePlatformService } from '@/shared/services/ModulePlatformService';

export class Core {
    // Services - Made public for EventHandler and GlobalBridge
    public readonly tauriProvider: TauriProvider;
    public readonly logger: LoggerService;
    public readonly i18n: I18nService;
    public readonly windowService: WindowService;
    public readonly moduleService: ModuleService;
    public readonly catalog: CatalogService;
    public readonly navigation: NavigationService;
    public readonly soundService: SoundService;
    public readonly stateStore: UiStateStore;
    public readonly uiSettings: UISettingsService;
    public readonly aiSettings: AISettingsService;
    public readonly downloadSettings: DownloadSettingsService;
    public readonly moduleSettings: ModuleSettingsService;
    public readonly particles: Particles;
    public readonly monitoringService: MonitoringService;
    public readonly monitoringUI: MonitoringUI;
    public readonly debugService: DebugService;
    public readonly debugUI: DebugUI;
    public readonly settingsService: SettingsService;
    public readonly chatController: ChatController;
    public readonly modulePlatformService: ModulePlatformService;

    // UI
    public readonly appUI: AppUI;
    public readonly i18nUI: I18nUI;
    public readonly windowUI: WindowUI;
    public readonly navigationUI: NavigationUI;
    public readonly sidebarUI: SidebarUI;
    public readonly downloadUI: DownloadUI;
    public readonly settingsUI: SettingsUI;

    private readonly _bridge: GlobalBridge;
    private readonly _eventHandler: EventHandler;

    private static readonly _SPLASH_TIMEOUT_MS = 2000;
    constructor() {
        // Initialize base services following Section 16 patterns
        this.tauriProvider = new TauriProvider();
        this.logger = logger;
        this.logger.init();
        // Wire transport so logger uses TauriProvider instead of raw __TAURI__ (§4.1)
        this.logger.setTransport((logs) => this.tauriProvider.invoke('log_batch', { logs }));

        this.logger.info(`AXELATE v${__APP_VERSION__}`);

        // 2. Init Core Services
        this.stateStore = new UiStateStore(this.tauriProvider);
        this.uiSettings = new UISettingsService(this.stateStore);
        this.aiSettings = new AISettingsService(this.stateStore);
        this.downloadSettings = new DownloadSettingsService(this.stateStore, this.tauriProvider);
        this.moduleSettings = new ModuleSettingsService(this.stateStore);
        this.moduleService = new ModuleService(this.tauriProvider);
        this.modulePlatformService = new ModulePlatformService(() => this.moduleService);
        this.windowService = new WindowService(this.tauriProvider);
        this.i18n = new I18nService(this.tauriProvider);
        this.catalog = new CatalogService(this.tauriProvider);
        this.navigation = NavigationService.getInstance();
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
        this.appUI = new AppUI(this.modulePlatformService);
        this.i18nUI = new I18nUI(this.i18n);
        this.windowUI = new WindowUI(this.windowService, this.uiSettings, this.soundService);
        this.navigationUI = new NavigationUI(this.navigation, this.soundService);
        this.sidebarUI = new SidebarUI(this.uiSettings, this.soundService);
        this.downloadUI = new DownloadUI(this.downloadSettings, this.i18n);
        this.settingsUI = new SettingsUI(
            this.settingsService,
            this.uiSettings,
            this.aiSettings,
            this.i18nUI,
            this.tauriProvider,
        );
        this.particles = new Particles();
        this.monitoringUI = new MonitoringUI(this.monitoringService);
        this.debugUI = new DebugUI(this.debugService);

        // 4. Init Event Handler and Bridge
        this._bridge = new GlobalBridge(this);
        this._bridge.init();

        this._eventHandler = new EventHandler(this);
        this._eventHandler.init();

        // Inject Core into Service Singletons (Section 16.2)
        aiBridge.setCore(this);

        this.chatController = new ChatController(aiBridge, this.i18n, this.soundService);
        this.chatController.init();
    }

    /**
     * Executes the core initialization sequence with hardened survival logic.
     */
    public async init(): Promise<void> {
        this.logger.debug('[Core] Init sequence started.');

        // 1. Emergency Safety Timeout (Guarantee splash disappears)
        const safetyTimeout = setTimeout(() => {
            this.logger.warn('[Core] Emergency bootstrap timeout triggered! Forcing UI reveal.');
            this.windowUI.hideSplashScreen();
        }, 12000);

        try {
            // 3. Fetch Bootstrap Data
            let bootstrapData: IBootstrapData | null = null;
            bootstrapData = await this._fetchBootstrapData();

            // 4. Critical Service hydration
            const templateLoadPromise = Promise.all([
                templateLoader.loadAndInject('components/sidebar', 'sidebar'),
                templateLoader.loadAndInject('pages/settings', 'page-settings'),
            ]).catch((e: unknown) => {
                this.logger.error(`[Core] Template loading failed: ${String(e)}`);
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
                    this.logger.warn(`[Core] Fast-path init failed: ${String(e)}`);
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

            // 6. Init Remaining Services
            await this.moduleService.init();
            await this.sidebarUI.init();
            this.navigationUI.init();
            this.downloadUI.init();
            await this.settingsUI.init();
            await this.monitoringUI.init();

            // 7. Catalog & AI (Resilient Load)
            globalThis.addEventListener('catalog-loaded', () => {
                this._restoreSelectedModules();
            });

            await aiBridge.init();
            await this.catalog.loadCatalog();

            this.i18nUI.applyTranslations();

            this.debugUI.init();
        } catch (e) {
            this.logger.error(`[Core] Critical bootstrap failure: ${String(e)}`);
        } finally {
            clearTimeout(safetyTimeout);
        }

        this._initGlobalShortcuts();

        // 8. Controlled Reveal - Sync with CSS
        this.logger.debug('[Core] App Ready. Hiding splash...');

        // Wait for splash animation (min 2s)
        await new Promise((r) => setTimeout(r, Core._SPLASH_TIMEOUT_MS));

        // Trigger Fade Out
        this.windowUI.hideSplashScreen();

        // Reveal UI elements underneath (they were hidden by .fade-in-init)
        setTimeout(() => {
            const elements = ['sidebar', 'app-header', 'main-area'];
            elements.forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.classList.remove('hidden'); // Ensure they are technically display:block
                // 'visible' class triggers opacity: 1 transition from splash.css
                if (el) el.classList.add('visible');
            });
        }, 50); // Almost immediate, let opacity handles transition

        this.logger.info('[Core] Ready.');
    }

    /**
     * Prevents browser default shortcuts that conflict with app UX.
     */
    private _initGlobalShortcuts(): void {
        globalThis.addEventListener('keydown', (e) => {
            const forbiddenKeys = ['F3', 'F7', 'F1'];
            if (forbiddenKeys.includes(e.key)) {
                e.preventDefault();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && ['f', 'p', 's'].includes(e.key.toLowerCase())) {
                e.preventDefault();
            }
        });
    }

    /**
     * Restores module selection from state.
     */
    private _restoreSelectedModules(): void {
        this.logger.debug('[Core] Restoring selected modules...');
        const selected = this.moduleSettings.getSelectedModules();

        for (const category of ['ai', 'services']) {
            const catSelection = selected[category];
            if (catSelection !== undefined) {
                const savedAppId = catSelection.id ?? '';
                const list = globalThis.getCatalogCategory(category);
                const fullApp = list.find((a: IApp) => a.id === savedAppId);

                if (fullApp !== undefined) {
                    this.appUI.updateModuleCard(category, fullApp);
                }
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
            this.logger.debug(
                `[Core] Bootstrap result: ${result === null ? 'Timed out' : 'Data fetched'}`,
            );
            return result;
        } catch (e) {
            this.logger.warn(`[Core] Bootstrap IPC failed: ${String(e)}`);
            return null;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const coreInstance = new Core();
    coreInstance.init().catch((e: unknown) => {
        logger.error(`[Core] Boot failed: ${String(e)}`);
    });

    const win = globalThis as unknown as Window & { core: Core };
    win.core = coreInstance;
});
