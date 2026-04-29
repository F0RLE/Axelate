import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { ChatController } from '@/features/chat/chat';
import type { DownloadUI } from '@/features/downloads/ui/DownloadUI';
import type { MonitoringService } from '@/features/monitoring/services/MonitoringService';
import type { SettingsService } from '@/features/settings/services/SettingsService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { NavigationUI } from '@/infrastructure/navigation/NavigationUI';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { CatalogService } from '@/shared/services/CatalogService';
import type { ModuleService } from '@/shared/services/ModuleService';
import type { SoundService } from '@/shared/services/SoundService';
import type { StateManager } from '@/shared/services/StateManager';
import type { TemplateLoader } from '@/shared/services/TemplateLoader';
import type { WindowService } from '@/shared/services/WindowService';
import type { ErrorHandler } from '@/shared/services/ErrorHandler';
import type { ModuleSettingsService } from '@/shared/services/modules/ModuleSettingsService';
import type { UiStateStore } from '@/shared/services/state/UiStateStore';
import type { AppUI } from '@/shared/shell/AppUI';
import type { GlobalTextContextMenu } from '@/shared/shell/GlobalTextContextMenu';
import type { Particles } from '@/shared/shell/Particles';
import type { SidebarUI } from '@/shared/shell/SidebarUI';
import type { WindowUI } from '@/shared/shell/WindowUI';
import type { IApp } from '@/shared/types/coreTypes';
import type { GlobalBridge } from './bridge';
import type { EventHandler } from './events';
import type {
    ClosableDeferredUiController,
    DeferredUiController,
    ModuleSettingsUiController,
} from './CoreUiContracts';
import { initializeDeferredUi, restoreSelectedModules } from './CoreRuntimeSupport';
import { destroyCoreResources } from './CoreComposition';
import { runCoreBootstrap } from './CoreBootstrapRunner';

export type CoreLifecycleState = {
    isDestroyed: () => boolean;
};

type SelectedModuleChangedPayload = {
    category: string;
    module: IApp;
    source?: string;
};

export type CoreBootstrapDeps = {
    aiBridge: AIBridge;
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
    chatController: ChatController;
    bridge: GlobalBridge;
    eventHandler: EventHandler;
};

export type CoreImmediateUiDeps = {
    navigation: NavigationService;
    navigationUI: NavigationUI;
    downloadUI: DownloadUI;
    moduleService: ModuleService;
    sidebarUI: SidebarUI;
};

type CoreDeferredUiDeps = {
    settingsService: SettingsService;
    monitoringUI: DeferredUiController;
    settingsUI: ClosableDeferredUiController;
    moduleSettingsUI: ModuleSettingsUiController;
    i18nUI: I18nUI;
    consoleUI: DeferredUiController;
    tracer: LoggerService;
    moduleSettings: ModuleSettingsService;
    catalog: CatalogService;
    appUI: AppUI;
    aiBridge: AIBridge;
};

type CoreBackendSelectionDeps = {
    tauriProvider: TauriProvider;
    stateStore: UiStateStore;
    appUI: AppUI;
};

export type CoreDisposables = {
    stateManager: StateManager;
    eventHandler: EventHandler;
    chatController: ChatController;
    appUI: AppUI;
    settingsUI: ClosableDeferredUiController;
    moduleSettingsUI: ModuleSettingsUiController;
    downloadUI: DownloadUI;
    navigationUI: NavigationUI;
    windowUI: WindowUI;
    windowService: WindowService;
    moduleService: ModuleService;
    i18nUI: I18nUI;
    consoleUI: DeferredUiController;
    monitoringUI: DeferredUiController;
    monitoringService: MonitoringService;
    sidebarUI: SidebarUI;
    particles: Particles;
    soundService: SoundService;
    stateStore: UiStateStore;
    aiBridge: AIBridge;
    bridge: GlobalBridge;
    errorHandler: ErrorHandler;
    globalTextContextMenu: GlobalTextContextMenu;
};

export type CoreLifecycleDeps = {
    bootstrap: CoreBootstrapDeps;
    immediateUi: CoreImmediateUiDeps;
    deferredUi: CoreDeferredUiDeps;
    backendSelection: CoreBackendSelectionDeps;
    disposables: CoreDisposables;
    state: CoreLifecycleState;
    globalShortcutKeydown: (e: KeyboardEvent) => void;
};

export class CoreLifecycleController {
    private _deferredChatInitTimer: ReturnType<typeof setTimeout> | null = null;
    private _selectedModuleChangedUnlisten: (() => void) | null = null;

    constructor(private readonly _deps: CoreLifecycleDeps) {}

    public async runInit(): Promise<void> {
        if (this._deps.state.isDestroyed()) {
            return;
        }

        const bootstrapResult = await runCoreBootstrap({
            bootstrap: this._deps.bootstrap,
            immediateUi: this._deps.immediateUi,
            registerGlobalShortcuts: () => {
                this.initGlobalShortcuts();
            },
        });
        if (this._deps.state.isDestroyed()) {
            return;
        }
        this._deps.disposables.globalTextContextMenu.init();

        if (bootstrapResult.currentPage !== 'chat') {
            this.scheduleDeferredChatInit();
        }

        await initializeDeferredUi({
            settingsService: this._deps.deferredUi.settingsService,
            monitoringUI: this._deps.deferredUi.monitoringUI,
            settingsUI: this._deps.deferredUi.settingsUI,
            moduleSettingsUI: this._deps.deferredUi.moduleSettingsUI,
            i18nUI: this._deps.deferredUi.i18nUI,
            consoleUI: this._deps.deferredUi.consoleUI,
            restoreSelectedModules: () => {
                restoreSelectedModules({
                    tracer: this._deps.deferredUi.tracer,
                    moduleSettings: this._deps.deferredUi.moduleSettings,
                    catalog: this._deps.deferredUi.catalog,
                    appUI: this._deps.deferredUi.appUI,
                });
            },
        });
        if (this._deps.state.isDestroyed()) {
            return;
        }
        await this._listenForBackendSelectedModuleChanges();
        if (this._deps.state.isDestroyed()) {
            return;
        }

        this._deps.bootstrap.tracer.info('[Core] Ready.');
    }

    public async destroy(): Promise<void> {
        globalThis.removeEventListener('keydown', this._deps.globalShortcutKeydown);
        try {
            this._selectedModuleChangedUnlisten?.();
        } catch (error) {
            this._deps.bootstrap.tracer.warn(
                '[Core] Failed to remove selected module listener during destroy:',
                error,
            );
        }
        this._selectedModuleChangedUnlisten = null;
        try {
            await destroyCoreResources({
                deferredChatInitTimer: this._deferredChatInitTimer,
                ...this._deps.disposables,
            });
        } finally {
            this._deferredChatInitTimer = null;
        }
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

            this._deps.bootstrap.chatController.init();
        }, 0);
    }

    private async _listenForBackendSelectedModuleChanges(): Promise<void> {
        const backendSelection = this._deps.backendSelection;
        if (
            !backendSelection.tauriProvider.isTauri() ||
            this._selectedModuleChangedUnlisten !== null
        ) {
            return;
        }

        const unlisten = await backendSelection.tauriProvider.listen<SelectedModuleChangedPayload>(
            'ui-state:selected-module-changed',
            (payload) => {
                this._applyBackendSelectedModuleChange(payload);
            },
        );
        if (this._deps.state.isDestroyed()) {
            unlisten();
            return;
        }
        this._selectedModuleChangedUnlisten = unlisten;
    }

    private _applyBackendSelectedModuleChange(payload: SelectedModuleChangedPayload): void {
        if (payload.category.trim() === '' || payload.module.id.trim() === '') {
            return;
        }

        this._deps.backendSelection.stateStore.updateNestedState(
            'selected_modules',
            payload.category,
            payload.module,
            false,
        );
        this._deps.backendSelection.appUI.updateModuleCard(payload.category, payload.module);
    }
}
