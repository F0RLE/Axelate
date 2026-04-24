import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { TemplateLoader } from '@/shared/services/TemplateLoader';
import type { UiStateStore } from '@/shared/services/state/UiStateStore';
import type { WindowService } from '@/shared/services/WindowService';
import type { WindowUI } from '@/shared/shell/WindowUI';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { CatalogService } from '@/shared/services/CatalogService';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { NavigationUI } from '@/infrastructure/navigation/NavigationUI';
import type { DownloadUI } from '@/features/downloads/ui/DownloadUI';
import type { ModuleService } from '@/shared/services/ModuleService';
import type { SidebarUI } from '@/shared/shell/SidebarUI';
import type { SettingsService } from '@/features/settings/services/SettingsService';
import type { ModuleSettingsService } from '@/shared/services/modules/ModuleSettingsService';
import type { AppUI } from '@/shared/shell/AppUI';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { ChatController } from '@/features/chat/chat';
import type { MonitoringService } from '@/features/monitoring/services/MonitoringService';
import type { Particles } from '@/shared/shell/Particles';
import type { SoundService } from '@/shared/services/SoundService';
import type { StateManager } from '@/shared/services/StateManager';
import type { EventHandler } from './events';
import type { GlobalBridge } from './bridge';
import type { ErrorHandler } from '@/shared/services/ErrorHandler';
import type { IApp } from '@/shared/types/coreTypes';
import {
    applyPlatformTheme,
    createBootstrapSafetyRevealTimer,
    fetchBootstrapData,
    hydrateCriticalServices,
    initializeDeferredUi,
    initializeImmediateUi,
    restoreSelectedModules,
    showInitialPage,
    waitForNextPaintCycle,
} from './CoreRuntimeSupport';
import { destroyCoreResources } from './CoreComposition';
import type {
    ClosableDeferredUiController,
    DeferredUiController,
    ModuleSettingsUiController,
} from './CoreUiContracts';

type CoreLifecycleState = {
    isDestroyed: () => boolean;
};

type SelectedModuleChangedPayload = {
    category: string;
    module: IApp;
    source?: string;
};

type CoreLifecycleDeps = {
    tauriProvider: TauriProvider;
    tracer: LoggerService;
    templateLoader: TemplateLoader;
    stateStore: UiStateStore;
    windowService: WindowService;
    windowUI: WindowUI;
    i18n: I18nService;
    i18nUI: I18nUI;
    catalog: CatalogService;
    navigation: NavigationService;
    navigationUI: NavigationUI;
    downloadUI: DownloadUI;
    moduleService: ModuleService;
    sidebarUI: SidebarUI;
    settingsService: SettingsService;
    monitoringUI: DeferredUiController;
    settingsUI: ClosableDeferredUiController;
    moduleSettingsUI: ModuleSettingsUiController;
    consoleUI: DeferredUiController;
    moduleSettings: ModuleSettingsService;
    appUI: AppUI;
    aiBridge: AIBridge;
    chatController: ChatController;
    stateManager: StateManager;
    eventHandler: EventHandler;
    bridge: GlobalBridge;
    errorHandler: ErrorHandler;
    monitoringService: MonitoringService;
    particles: Particles;
    soundService: SoundService;
    state: CoreLifecycleState;
    globalShortcutKeydown: (e: KeyboardEvent) => void;
};

export class CoreLifecycleController {
    private _deferredChatInitTimer: ReturnType<typeof setTimeout> | null = null;
    private _selectedModuleChangedUnlisten: (() => void) | null = null;

    constructor(private readonly _deps: CoreLifecycleDeps) {}

    public async runInit(): Promise<void> {
        this._deps.tracer.debug('[Core] Init sequence started.');
        applyPlatformTheme();
        this._deps.bridge.init();
        this._deps.eventHandler.init();

        const safetyTimeout = createBootstrapSafetyRevealTimer({
            tracer: this._deps.tracer,
            windowService: this._deps.windowService,
            windowUI: this._deps.windowUI,
        });

        try {
            const bootstrapData = await fetchBootstrapData(
                this._deps.tauriProvider,
                this._deps.tracer,
            );
            await hydrateCriticalServices({
                bootstrapData,
                templateLoader: this._deps.templateLoader,
                stateStore: this._deps.stateStore,
                windowService: this._deps.windowService,
                windowUI: this._deps.windowUI,
                i18n: this._deps.i18n,
                i18nUI: this._deps.i18nUI,
                catalog: this._deps.catalog,
                tracer: this._deps.tracer,
            });
            await showInitialPage({
                navigation: this._deps.navigation,
                stateStore: this._deps.stateStore,
                chatController: this._deps.chatController,
                navigationUI: this._deps.navigationUI,
            });
            await this._deps.windowService.show();
            await initializeImmediateUi({
                navigation: this._deps.navigation,
                navigationUI: this._deps.navigationUI,
                downloadUI: this._deps.downloadUI,
                moduleService: this._deps.moduleService,
                sidebarUI: this._deps.sidebarUI,
            });
        } catch (e) {
            this._deps.tracer.error(`[Core] Critical bootstrap failure: ${String(e)}`);
            void this._deps.windowService.show().catch(() => {
                /* ignore emergency reveal failure */
            });
            this._deps.windowUI.hideSplashScreen();
            throw e;
        } finally {
            clearTimeout(safetyTimeout);
        }

        this.initGlobalShortcuts();

        this._deps.tracer.debug('[Core] App Ready. Hiding splash...');
        await waitForNextPaintCycle();
        this._deps.windowUI.hideSplashScreen();

        if (this._deps.navigation.getCurrentPage() !== 'chat') {
            this.scheduleDeferredChatInit();
        }

        await initializeDeferredUi({
            settingsService: this._deps.settingsService,
            monitoringUI: this._deps.monitoringUI,
            settingsUI: this._deps.settingsUI,
            moduleSettingsUI: this._deps.moduleSettingsUI,
            i18nUI: this._deps.i18nUI,
            consoleUI: this._deps.consoleUI,
            restoreSelectedModules: () => {
                restoreSelectedModules({
                    tracer: this._deps.tracer,
                    moduleSettings: this._deps.moduleSettings,
                    catalog: this._deps.catalog,
                    appUI: this._deps.appUI,
                    aiBridge: this._deps.aiBridge,
                });
            },
        });
        await this._listenForBackendSelectedModuleChanges();

        this._deps.tracer.info('[Core] Ready.');
    }

    public destroy(globalShortcutKeydown: (e: KeyboardEvent) => void): void {
        globalThis.removeEventListener('keydown', globalShortcutKeydown);
        this._selectedModuleChangedUnlisten?.();
        this._selectedModuleChangedUnlisten = null;
        destroyCoreResources({
            deferredChatInitTimer: this._deferredChatInitTimer,
            stateManager: this._deps.stateManager,
            eventHandler: this._deps.eventHandler,
            chatController: this._deps.chatController,
            appUI: this._deps.appUI,
            settingsUI: this._deps.settingsUI,
            moduleSettingsUI: this._deps.moduleSettingsUI,
            downloadUI: this._deps.downloadUI,
            navigationUI: this._deps.navigationUI,
            windowUI: this._deps.windowUI,
            windowService: this._deps.windowService,
            moduleService: this._deps.moduleService,
            i18nUI: this._deps.i18nUI,
            consoleUI: this._deps.consoleUI,
            monitoringUI: this._deps.monitoringUI,
            monitoringService: this._deps.monitoringService,
            sidebarUI: this._deps.sidebarUI,
            particles: this._deps.particles,
            soundService: this._deps.soundService,
            stateStore: this._deps.stateStore,
            aiBridge: this._deps.aiBridge,
            bridge: this._deps.bridge,
            errorHandler: this._deps.errorHandler,
        });
        this._deferredChatInitTimer = null;
    }

    public initGlobalShortcuts(globalShortcutKeydown?: (e: KeyboardEvent) => void): void {
        globalThis.addEventListener(
            'keydown',
            globalShortcutKeydown ?? this._deps.globalShortcutKeydown,
        );
    }

    public scheduleDeferredChatInit(): void {
        if (this._deferredChatInitTimer !== null) {
            return;
        }

        this._deferredChatInitTimer = globalThis.setTimeout(() => {
            this._deferredChatInitTimer = null;
            if (this._deps.state.isDestroyed()) {
                return;
            }

            this._deps.chatController.init();
        }, 0);
    }

    private async _listenForBackendSelectedModuleChanges(): Promise<void> {
        if (!this._deps.tauriProvider.isTauri() || this._selectedModuleChangedUnlisten !== null) {
            return;
        }

        this._selectedModuleChangedUnlisten =
            await this._deps.tauriProvider.listen<SelectedModuleChangedPayload>(
                'ui-state:selected-module-changed',
                (payload) => {
                    this._applyBackendSelectedModuleChange(payload);
                },
            );
    }

    private _applyBackendSelectedModuleChange(payload: SelectedModuleChangedPayload): void {
        if (payload.category.trim() === '' || payload.module.id.trim() === '') {
            return;
        }

        this._deps.stateStore.updateNestedState(
            'selected_modules',
            payload.category,
            payload.module,
            false,
        );
        this._deps.appUI.updateModuleCard(payload.category, payload.module);
    }
}
