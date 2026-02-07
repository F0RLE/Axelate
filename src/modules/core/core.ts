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
import { SoundService } from './services/SoundService';
import { logger, type LoggerService } from './services/LoggerService';
import { templateLoader } from './services/TemplateLoader';
import type { IApp } from './types/coreTypes';
import { EventHandler } from './boot/EventHandler';
import { StateService } from './services/StateService';
import { GlobalBridge } from './boot/GlobalBridge';
import { Particles } from './ui/Particles';
import { MonitoringService } from '../monitoring/services/MonitoringService';
import { MonitoringUI } from '../monitoring/ui/MonitoringUI';
import { DebugService } from '../debug/services/DebugService';
import { DebugUI } from '../debug/ui/DebugUI';
import { SettingsService } from '../settings/services/SettingsService';
import { SettingsUI } from '../settings/ui/SettingsUI';
import { aiBridge } from '../ai/AIBridge';

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
        console.log(
            `%c AXELATE %c v${__APP_VERSION__} `,
            'color: #06b6d4; font-family: "Segoe UI", sans-serif; font-size: 24px; font-weight: 900; text-shadow: 0 0 5px rgba(6,182,212,0.5); margin-bottom: 8px;',
            'color: #cbd5e1; font-family: monospace; font-size: 10px; background: #334155; padding: 2px 6px; border-radius: 4px; vertical-align: middle;',
        );

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
        this.navigation = NavigationService.getInstance();
        this.soundService = new SoundService();
        this.state = new StateService(this);

        // Inject StateService into WindowService (Dependency Injection) to ensure zoom sync
        // works immediately, avoiding startup race conditions.
        this.windowService.setStateService(this.state);
        this.navigation.setStateService(this.state);

        this.monitoringService = new MonitoringService(this.tauriProvider);
        this.debugService = new DebugService();
        this.settingsService = new SettingsService();

        // 3. Init UI Handlers
        this.appUI = new AppUI();
        this.i18nUI = new I18nUI(this.i18n);
        this.windowUI = new WindowUI(this.windowService, this.state, this.soundService);
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

        // Inject Core into Service Singletons (Section 16.2)
        aiBridge.setCore(this);
    }

    /**
     * Executes the core initialization sequence with hardened survival logic.
     */
    public async init(): Promise<void> {
        console.groupCollapsed('%c[Core] Init Sequence', 'color: #94a3b8; font-weight: 500;');
        console.info('[Core] Init sequence started.');

        // 1. Emergency Safety Timeout (Guarantee splash disappears)
        const safetyTimeout = setTimeout(() => {
            console.warn('[Core] Emergency bootstrap timeout triggered! Forcing UI reveal.');
            this.windowUI.hideSplashScreen();
        }, 12000);

        try {
            // 2. Initialize Global Bridge early
            this._globalBridge.init();

            // 3. Fetch Bootstrap Data (with 5s timeout guard)
            let bootstrapData: import('./types/coreTypes').IBootstrapData | null = null;
            try {
                if (this.tauriProvider.isTauri()) {
                    const bootstrapPromise =
                        this.tauriProvider.invoke<import('./types/coreTypes').IBootstrapData>(
                            'get_app_bootstrap_data',
                        );
                    const timeoutPromise = new Promise<null>((r) =>
                        setTimeout(() => {
                            r(null);
                        }, 5000),
                    );

                    bootstrapData = await Promise.race([bootstrapPromise, timeoutPromise]);
                    console.debug(
                        '[Core] Bootstrap result:',
                        bootstrapData ? 'Data fetched' : 'Timed out',
                    );
                }
            } catch (e) {
                console.warn('[Core] Bootstrap IPC failed:', e);
            }

            // 4. Critical Service hydration
            const templateLoadPromise = Promise.all([
                templateLoader.loadAndInject('components/sidebar', 'sidebar'),
                templateLoader.loadAndInject('pages/settings', 'page-settings'),
            ]).catch((e: unknown) => {
                console.error('[Core] Template loading failed:', e);
            });

            if (bootstrapData) {
                this.state.setState(bootstrapData.uiState);
                try {
                    await this.windowService.init(
                        bootstrapData.windowConfig,
                        bootstrapData.initialZoom,
                    );
                    this.windowUI.init();
                    await this.i18n.init(bootstrapData.systemLanguage);
                } catch (e) {
                    console.warn('[Core] Fast-path init failed:', e);
                }
                await templateLoadPromise;
            } else {
                await Promise.all([this.state.loadState(), templateLoadPromise]);
                await this.windowService.init();
                this.windowUI.init();
                await this.i18n.init();
            }

            this.i18nUI.applyTranslations();
            const win = globalThis as unknown as Window;
            win.uiState = this.state as unknown as Window['uiState'];

            this.navigation.refreshFromUiState();
            const currentPage = this.navigation.getCurrentPage();
            await this.navigationUI.showPage(currentPage || 'home', null, true);

            // 5. Show Window (race with timeout)
            const showPromise = this.windowService.show();
            const showTimeout = new Promise((r) => setTimeout(r, 3000));
            await Promise.race([showPromise, showTimeout]);

            // 6. Init Remaining Services
            await this.moduleService.init();
            await this.sidebarUI.init();
            this.navigationUI.init();
            this.downloadUI.init();
            await this.settingsUI.init();
            this.monitoringUI.init();

            // 7. Catalog & AI (Resilient Load)
            globalThis.addEventListener('catalog-loaded', () => {
                this._restoreSelectedModules();
            });

            await aiBridge.init();
            await this.catalog.loadCatalog();

            this.i18nUI.applyTranslations();

            if (import.meta.env.DEV) {
                this.debugUI.init();
            } else {
                const debugEntry = document.querySelector('.debug-trigger');
                if (debugEntry instanceof HTMLElement) debugEntry.style.display = 'none';
                const debugPanel = document.getElementById('debug-panel');
                if (debugPanel) debugPanel.style.display = 'none';
            }
        } catch (e) {
            console.error('[Core] Critical bootstrap failure:', e);
        } finally {
            clearTimeout(safetyTimeout);
        }

        this._initGlobalShortcuts();

        // 8. Controlled Reveal
        console.debug('[Core] App Ready. Hiding splash...');
        await new Promise((r) => setTimeout(r, Core._SPLASH_TIMEOUT_MS));

        this.windowUI.hideSplashScreen();

        setTimeout(() => {
            const elements = ['sidebar', 'app-header', 'main-area'];
            elements.forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.classList.add('visible');
            });
        }, Core._UI_REVEAL_DELAY_MS);

        console.info('[Core] Ready.');
        console.groupEnd();
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
        console.debug('[Core] Restoring selected modules...');
        const selected = this.state.getState().selected_modules || {};

        for (const category of ['ai', 'services']) {
            if (selected[category]) {
                const savedAppId = selected[category]?.id || '';
                const list = globalThis.getCatalogCategory(category);
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
