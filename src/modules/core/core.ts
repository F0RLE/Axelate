import { TauriProvider } from './services/TauriProvider';
import { ModuleService } from './services/ModuleService';
import { I18nService } from './services/I18nService';
import { I18nUI } from './ui/I18nUI';
import { WindowService } from './services/WindowService';
import { WindowUI } from './ui/WindowUI';
import { CatalogService } from './services/CatalogService';
import { NavigationService } from './services/NavigationService';
import { NavigationUI } from './ui/NavigationUI';
import { SidebarUI } from './ui/SidebarUI';
import { AppUI } from './ui/AppUI';
import { DownloadUI } from '../downloader/ui/DownloadUI';
import { DiagnosticsService } from './services/DiagnosticsService';
import { SoundService } from './services/SoundService';
import { logger, LoggerService } from './services/LoggerService';
import { templateLoader } from './services/TemplateLoader';
import { IApp } from './types/coreTypes';
import { EventHandler } from './boot/EventHandler';
import { StateService } from './services/StateService';
import { GlobalBridge } from './boot/GlobalBridge';
import { failsafe } from './boot/failsafe';
import { Particles } from './ui/Particles';
import { MonitoringService } from '../monitoring/services/MonitoringService';
import { MonitoringUI } from '../monitoring/ui/MonitoringUI';
import { DebugService } from '../debug/services/DebugService';
import { DebugUI } from '../debug/ui/DebugUI';
import { SettingsService } from '../settings/services/SettingsService';
import { SettingsUI } from '../settings/ui/SettingsUI';
import '../ai'; // Initialize AIBridge global singleton

export class Core {
    // Services - Made public for EventHandler and GlobalBridge
    public readonly tauriProvider: TauriProvider;
    public readonly logger: LoggerService;
    public readonly i18n: I18nService;
    public readonly windowService: WindowService;
    public readonly moduleService: ModuleService;
    public readonly catalog: CatalogService;
    public readonly navigation: NavigationService;
    public readonly diagnostics: DiagnosticsService;
    public readonly soundService: SoundService;
    public readonly state: StateService;
    public readonly particles: Particles;
    public readonly monitoringService: MonitoringService;
    public readonly monitoringUI: MonitoringUI;
    public readonly debugService: DebugService;
    public readonly debugUI: DebugUI;
    public readonly settingsService: SettingsService;

    // UI
    public readonly appUI: AppUI;
    public readonly i18nUI: I18nUI;
    public readonly windowUI: WindowUI;
    public readonly navigationUI: NavigationUI;
    public readonly sidebarUI: SidebarUI;
    public readonly downloadUI: DownloadUI;
    public readonly settingsUI: SettingsUI;

    private readonly _eventHandler: EventHandler;
    private readonly _globalBridge: GlobalBridge;

    private static readonly _SPLASH_TIMEOUT_MS = 1500;
    private static readonly _UI_REVEAL_DELAY_MS = 200;

    constructor() {
        console.debug('[Core] Constructor started.');

        // Initialize base services following Section 16 patterns
        this.tauriProvider = new TauriProvider();
        this.logger = logger;
        this.logger.init();

        // 2. Init Core Services
        this.i18n = new I18nService(this.tauriProvider);
        templateLoader.init();
        this.windowService = new WindowService(this.tauriProvider);
        this.moduleService = new ModuleService(this.tauriProvider);
        this.catalog = new CatalogService(this.tauriProvider);
        this.navigation = NavigationService.getInstance();
        this.diagnostics = new DiagnosticsService(this.tauriProvider, this.i18n);
        this.soundService = new SoundService();
        this.state = new StateService(this);
        this.monitoringService = new MonitoringService();
        this.debugService = new DebugService();
        this.settingsService = new SettingsService();

        // 3. Init UI Handlers
        this.appUI = new AppUI();
        this.i18nUI = new I18nUI(this.i18n);
        this.windowUI = new WindowUI(this.windowService, this.i18n);
        this.navigationUI = new NavigationUI(this.navigation, this.soundService);
        this.sidebarUI = new SidebarUI(this.state, this.soundService);
        this.downloadUI = new DownloadUI();
        this.settingsUI = new SettingsUI(this.settingsService, this.state);
        this.particles = new Particles();
        this.monitoringUI = new MonitoringUI(this.monitoringService);
        this.debugUI = new DebugUI(this.debugService);

        // 4. Init Event Handler
        this._eventHandler = new EventHandler(this);
        this._eventHandler.init();

        // 5. Init Global Bridge
        this._globalBridge = new GlobalBridge(this);
    }

    /**
     * Executes the core initialization sequence.
     */
    public async init(): Promise<void> {
        console.info('[Core] Init sequence started.');

        // 1. Initialize Global Bridge early
        this._globalBridge.init();

        // 2. Load UI State & Templates
        console.debug('[Core] Loading UI State & Templates...');

        // Load critical templates early in parallel
        const templateLoadPromise = Promise.all([
            templateLoader.loadAndInject('components/sidebar', 'sidebar'),
            templateLoader.loadAndInject('pages/settings', 'page-settings'),
        ]).catch((e) => console.error('[Core] Template loading failed:', e));

        await Promise.all([this.state.loadState(), templateLoadPromise]);

        const win = globalThis as unknown as Window & { uiState: StateService };
        win.uiState = this.state;

        this.navigation.refreshFromUiState();
        console.debug('[Core] UI State Loaded.');

        // 3. Reveal UI and hide splash screen as soon as state is ready
        const revealUI = async () => {
            console.debug('[Core] Revealing UI...');

            // 1. Show the window immediately (with a timeout safety)
            // This ensures the user sees the splash screen if this is a cold boot
            const showPromise = this.windowService.show();
            const showTimeout = new Promise((r) => setTimeout(r, 2000)); // 2s safety

            await Promise.race([showPromise, showTimeout]).catch((e) =>
                console.warn('[Core] Show window timed out or failed', e),
            );

            // 2. Enforce minimum splash duration to allow animations to play
            // This fixes the "instant flash" issue on reloads
            await new Promise((r) => setTimeout(r, Core._SPLASH_TIMEOUT_MS));

            // 3. Hide the splash screen
            this.windowUI.hideSplashScreen();

            // 4. Transition to home page and reveal layout
            setTimeout(() => {
                const currentPage = this.navigation.getCurrentPage();
                this.navigationUI.showPage(currentPage || 'home', null, true);

                // Initialization confirmed, cancel failsafe
                failsafe.cancel();

                const elements = ['sidebar', 'app-header', 'main-area'];
                elements.forEach((id) => {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('visible');
                });
            }, Core._UI_REVEAL_DELAY_MS);
        };

        // Don't await revealUI here to prevent it from blocking the rest of the init() sequence
        // (i.e. i18n, services, etc. should start initializing in parallel)
        revealUI();

        // 4. Init I18n
        try {
            await this.i18n.init();
            this.i18nUI.applyTranslations();
        } catch (e) {
            console.error('[Core] I18n init failed:', e);
        }

        // 5. Init Services
        try {
            await this.windowService.init();
            await this.moduleService.init();
            this.windowUI.init();
            await this.sidebarUI.init();
            this.navigationUI.init();
            this.downloadUI.init();
            await this.settingsUI.init();
            this.monitoringUI.init();

            // 6. Final UI Polish (Translations & Initial Page)
            this.i18nUI.applyTranslations();

            // Only show debug UI in development
            if (import.meta.env.DEV) {
                this.debugUI.init();
            } else {
                // Hide debug entry point in production
                const debugEntry = document.querySelector('.debug-trigger') as HTMLElement;
                if (debugEntry) debugEntry.style.display = 'none';

                // Also hide the debug panel container if it exists
                const debugPanel = document.getElementById('debug-panel');
                if (debugPanel) debugPanel.style.display = 'none';
            }
        } catch (e) {
            console.error('[Core] Services init failed:', e);
        }

        // 6. Init Catalog
        globalThis.addEventListener('catalog-loaded', () => {
            this._restoreSelectedModules();
        });
        this.catalog.loadCatalog();

        // 7. Start Polling (Monitoring handles its own lifecycle)
        // this.diagnostics.startPolling(); // Disabled to prevent flickering conflict

        this._initGlobalShortcuts();
        console.info('[Core] Ready.');
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
    private async _restoreSelectedModules(): Promise<void> {
        console.debug('[Core] Restoring selected modules...');
        const selected = this.state.getState().selected_modules || {};
        const catalog = this.catalog.getCatalog();

        for (const category of ['ai', 'services']) {
            if (selected[category]) {
                const savedAppId = selected[category]?.id || '';
                const list = (catalog[category] as IApp[]) || [];
                const fullApp = list.find((a: IApp) => a.id === savedAppId);

                if (fullApp) {
                    this.appUI.updateModuleCard(category, fullApp);
                }
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const coreInstance = new Core();
    coreInstance.init().catch(console.error);

    const win = globalThis as unknown as Window & { core: Core };
    win.core = coreInstance;
});
