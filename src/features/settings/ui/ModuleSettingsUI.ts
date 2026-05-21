/**
 * @module settings/ui/ModuleSettingsUI
 * @description UI management for module settings modal rendering and engine/provider configuration.
 *
 * @example
 * ```typescript
 * const moduleSettingsUI = new ModuleSettingsUI(settingsService, stateService);
 * moduleSettingsUI.init();
 * ```
 */

import type { EventBus } from '@/shared/services/EventBus';
import { aiSettingsRenderer } from '@/features/ai/ui/AISettingsRenderer';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { type SettingsService } from '../services/SettingsService';
import { type UISettingsService } from '@/shared/services/ui/UISettingsService';
import { type AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { IApp } from '@/shared/types/coreTypes';
import type { IModuleSettingsUIContext } from './SettingsContext';
import { CardResizer } from './components/CardResizer';
import { type I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import { type TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import { type NavigationService } from '@/infrastructure/navigation/NavigationService';
import { EngineConfigService } from '@/features/ai/services/EngineConfigService';
import { ModuleSettingsModalController } from './ModuleSettingsModalController';
import type { ModuleSettingsAutosaveController } from './ModuleSettingsAutosaveController';
import type { ModuleSettingsCustomUiController } from './ModuleSettingsCustomUiController';
import type { ModuleSettingsEngineRenderer } from './ModuleSettingsEngineRenderer';
import type { ModuleSettingsSchemaRenderer } from './ModuleSettingsSchemaRenderer';
import { resolveModuleSettingsRenderPlan } from './ModuleSettingsRenderPlan';
import { ModuleSettingsViewHelper } from './ModuleSettingsViewHelper';
import { ModuleSettingsControllerFactory } from './ModuleSettingsControllerFactory';
import { supportsModuleSettings } from '@/shared/utils/moduleSettingsSupport';
type ModuleSettingsUIDeps = {
    eventBus: EventBus;
    tracer: Pick<LoggerService, 'error' | 'warn' | 'info' | 'debug'>;
    showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
    reopenModuleSettings: (app: IApp) => void;
    closeAppSelection: () => void;
    onModuleSettingsChanged: (app: IApp) => void;
};

type ModuleSettingsModalElements = {
    modal: HTMLDialogElement;
    container: HTMLElement;
    title: HTMLElement;
};

export class ModuleSettingsUI {
    private readonly _unsubscribers: (() => void)[] = [];
    private _context!: IModuleSettingsUIContext;
    private _resizer: CardResizer | null = null;
    private readonly _engineConfigService: EngineConfigService;
    private readonly _controllerFactory: ModuleSettingsControllerFactory;
    private _engineRenderer: ModuleSettingsEngineRenderer | null = null;
    private _schemaRenderer: ModuleSettingsSchemaRenderer | null = null;
    private readonly _modalController: ModuleSettingsModalController;
    private readonly _viewHelper = new ModuleSettingsViewHelper();
    private _autosaveController: ModuleSettingsAutosaveController | null = null;
    private _customUiController: ModuleSettingsCustomUiController | null = null;
    private readonly _moduleCleanupHandlers: Array<() => void> = [];
    private readonly _boundLangChanged = () => {
        this.refreshActiveModule();
    };
    private readonly _boundDropdownDocumentClick = (event: MouseEvent) => {
        this._viewHelper.closeLanguageDropdowns(event);
    };
    private _isInitialized = false;
    private _isDestroyed = false;
    private _activeOpenRequest: {
        appId: string;
        promise: Promise<void>;
    } | null = null;

    constructor(
        private readonly _service: SettingsService,
        private readonly _uiSettings: UISettingsService,
        private readonly _aiSettings: AISettingsService,
        private readonly _i18n: I18nService,
        private readonly _i18nUI: I18nUI,
        private readonly _tauri: TauriProvider,
        _navigation: NavigationService,
        private readonly _deps: ModuleSettingsUIDeps,
    ) {
        this._engineConfigService = new EngineConfigService(_tauri, this._deps.tracer);
        this._modalController = new ModuleSettingsModalController(_navigation, {
            closeAppSelection: () => {
                this._deps.closeAppSelection();
            },
        });
        this._controllerFactory = new ModuleSettingsControllerFactory({
            service: this._service,
            tauri: this._tauri,
            tracer: this._deps.tracer,
            engineConfigService: this._engineConfigService,
            getContext: () => this._context,
            registerCleanup: (cleanup) => {
                this._registerModuleCleanup(cleanup);
            },
            debouncedSave: (key, value) => {
                this._debouncedSave(key, value);
            },
            notifySettingsChanged: () => {
                this._notifyCurrentModuleSettingsChanged();
            },
            showSaveIndicator: () => {
                this._showSaveIndicator();
            },
            showSaveErrorIndicator: () => {
                this._showSaveErrorIndicator();
            },
            hideSaveIndicator: () => {
                this._hideSaveIndicator();
            },
            showDirtyIndicator: () => {
                this._showDirtySettingsIndicator();
            },
        });
    }
    /**
     * Initializes the settings UI, renders components, and binds events.
     */
    public async init(): Promise<void> {
        if (this._isInitialized || this._isDestroyed) return;
        this._isInitialized = true;

        this._context = this._createContext();

        await aiSettingsRenderer.init(
            this._service,
            this._aiSettings,
            this._tauri,
            this._context.i18nUI,
            this._context.t,
            this._deps.tracer,
            (message, type) => {
                this._deps.showToast(message, type);
            },
        );

        this._subscribeCoreEvents();
        this._loadCardWidths();
        this._initCardResizer();

        this._bindGlobalEvents();
    }

    public close(): void {
        this._resetAutosaveState();
        this._resetDynamicModuleState();
        this._unbindDropdownEvents();
        delete this._context.currentModule;
        this._modalController.close();
    }

    public async openModuleSettings(app: IApp): Promise<void> {
        const activeRequest = this._activeOpenRequest;
        if (activeRequest?.appId === app.id) {
            await activeRequest.promise;
            return;
        }

        const openPromise = this._openModuleSettingsHelper(app).finally(() => {
            if (this._activeOpenRequest?.promise === openPromise) {
                this._activeOpenRequest = null;
            }
        });

        this._activeOpenRequest = {
            appId: app.id,
            promise: openPromise,
        };

        await openPromise;
    }

    /**
     * Re-renders the currently open settings module (e.g. on language change).
     */
    public refreshActiveModule(): void {
        if (this._activeOpenRequest !== null) {
            return;
        }

        const currentApp = this._context.currentModule;
        const elements = this._getModalElements();

        if (currentApp === undefined || !this._isModuleModalOpen(elements)) return;

        this._deps.tracer.debug(
            '[ModuleSettingsUI] Refreshing active module settings:',
            currentApp.id,
        );
        this._applyModuleTitle(elements.title, currentApp);
        this._renderSpecializedModuleConfig(elements.container, currentApp).catch((e: unknown) => {
            this._deps.tracer.error(String(e));
        });
    }

    /**
     * Resets internal state and deactivates observers.
     * MANDATORY cleanup method required by Section 4.3.
     */
    public destroy(): void {
        if (this._isDestroyed) return;
        this._isDestroyed = true;
        this._isInitialized = false;

        this.close();
        this._cleanupSubscriptions();
        this._unbindGlobalEvents();
        this._destroyCardResizer();
        aiSettingsRenderer.destroy();
        this._deps.tracer.info('[ModuleSettingsUI] Destroyed.');
    }

    private _createContext(): IModuleSettingsUIContext {
        return {
            t: (key, defaultValue, params) =>
                this._i18n.t(
                    key,
                    defaultValue,
                    (params as Record<string, unknown> | undefined) ?? {},
                ),
            showToast: (message: string, type?: 'success' | 'error' | 'info') => {
                this._deps.showToast(message, type);
            },
            i18nUI: this._i18nUI,
        };
    }

    private _subscribeCoreEvents(): void {
        const unsubscribePageChange = this._deps.eventBus.on('page:change', () => {
            this.close();
        });
        this._unsubscribers.push(unsubscribePageChange);
    }

    private _bindGlobalEvents(): void {
        globalThis.addEventListener('language-changed', this._boundLangChanged);
    }

    private _unbindGlobalEvents(): void {
        this._unbindDropdownEvents();
        globalThis.removeEventListener('language-changed', this._boundLangChanged);
    }

    private _initCardResizer(): void {
        this._resizer = new CardResizer((id: string, width: string) => {
            this._uiSettings.setCardWidth(id, width);
        });
        this._resizer.init();
    }

    private _destroyCardResizer(): void {
        this._resizer?.destroy();
        this._resizer = null;
    }

    private _cleanupSubscriptions(): void {
        this._unsubscribers.forEach((unsubscribe) => {
            unsubscribe();
        });
        this._unsubscribers.length = 0;
    }

    /**
     * Renders a specialized module configuration UI (API, Local AI, or generic).
     */
    private async _renderSpecializedModuleConfig(container: HTMLElement, app: IApp) {
        this._resetDynamicModuleState();
        container.classList.remove('module-settings-custom-ui-active');
        document
            .getElementById('module-settings-modal')
            ?.classList.remove('module-settings-modal-custom-ui');
        document
            .getElementById('module-settings-content')
            ?.classList.remove('module-settings-content-custom-ui');

        const plan = resolveModuleSettingsRenderPlan(app);
        switch (plan.kind) {
            case 'custom-ui':
                await this._renderCustomSettingsUi(container, app);
                return;
            case 'universal-api':
                await this._renderApiSettingsViaAiRenderer(container, app);
                return;
            case 'empty-state':
                this._renderEmptyState(container, app);
                return;
            case 'local-engine':
                await this._renderLocalEngineConfig(container, app);
                return;
            case 'schema':
                this._renderSchemaModuleConfig(container, app);
                return;
            default:
                return;
        }
    }

    private _renderSchemaModuleConfig(container: HTMLElement, app: IApp): void {
        this._getSchemaRenderer().renderSchemaModuleConfig(container, app);
    }

    /**
     * Renders a standardized empty state for modules with no settings.
     * "There is nothing there" - Minimalist visual standard.
     */
    private _renderEmptyState(container: HTMLElement, _app: IApp) {
        this._getSchemaRenderer().renderEmptyState(container);
    }

    /**
     * Renders engine config form for local engines (llamacpp, sdcpp, etc.).
     * Loads the persisted EngineConfig from Tauri, renders fields, saves on change.
     */
    private async _renderLocalEngineConfig(container: HTMLElement, app: IApp): Promise<void> {
        await this._getEngineRenderer().render(container, app);
    }

    /** Renders universal API settings using the AIRenderer. */
    private async _renderApiSettingsViaAiRenderer(
        container: HTMLElement,
        app: IApp,
    ): Promise<void> {
        await aiSettingsRenderer.render(container, app);
    }

    // --- Card Resizing ---

    private _loadCardWidths() {
        this._viewHelper.loadCardWidths(
            () => this._uiSettings.getCardWidths(),
            (card, width) => {
                this._updateCardLayout(card, width);
            },
        );
    }

    private _updateCardLayout(card: HTMLElement, width: string) {
        this._viewHelper.updateCardLayout(card, width);
    }

    private async _renderCustomSettingsUi(container: HTMLElement, app: IApp): Promise<void> {
        await this._getCustomUiController().render(container, app);
    }

    private _showDirtySettingsIndicator(): void {
        this._viewHelper.showDirtySettingsIndicator((key, defaultValue) =>
            this._context.t(key, defaultValue),
        );
    }

    // Card Resizing delegated to CardResizer component

    // --- Auto Save ---

    /**
     * Binds global events (e.g. clicking outside dropdowns).
     */
    private _bindEvents() {
        document.removeEventListener('click', this._boundDropdownDocumentClick);
        document.addEventListener('click', this._boundDropdownDocumentClick);
    }

    private _unbindDropdownEvents(): void {
        document.removeEventListener('click', this._boundDropdownDocumentClick);
    }

    private _registerModuleCleanup(cleanup: () => void): void {
        this._moduleCleanupHandlers.push(cleanup);
    }

    private _resetDynamicModuleState(): void {
        this._engineRenderer?.reset();

        while (this._moduleCleanupHandlers.length > 0) {
            const cleanup = this._moduleCleanupHandlers.pop();
            cleanup?.();
        }
    }

    /**
     * Helper to open the settings modal for a specific module.
     */
    private async _openModuleSettingsHelper(app: IApp) {
        if (!supportsModuleSettings(app)) {
            return;
        }

        const elements = this._getModalElements();
        if (elements === null) return;

        this._resetAutosaveState();
        this._context.currentModule = app;
        this._applyModuleTitle(elements.title, app);

        this._modalController.open(
            app.id,
            () => {
                this.close();
            },
            () => {
                this._deps.reopenModuleSettings(app);
            },
        );
        await new Promise<void>((resolve) => {
            globalThis.requestAnimationFrame(() => {
                resolve();
            });
        });

        await this._renderSpecializedModuleConfig(elements.container, app);
        this._context.i18nUI.applyTranslations(elements.container);
        this._bindEvents();
    }

    private _getModalElements(): ModuleSettingsModalElements | null {
        const modal = document.getElementById('module-settings-modal');
        const container = document.getElementById('module-config-modal-active');
        const title = document.getElementById('module-settings-title');

        if (
            !(modal instanceof HTMLDialogElement) ||
            !(container instanceof HTMLElement) ||
            !(title instanceof HTMLElement)
        ) {
            return null;
        }

        return { modal, container, title };
    }

    private _isModuleModalOpen(
        elements: ModuleSettingsModalElements | null,
    ): elements is ModuleSettingsModalElements {
        return elements?.modal.open === true;
    }

    private _applyModuleTitle(title: HTMLElement, app: IApp): void {
        title.textContent = this._viewHelper.getModuleSettingsTitle(app, (key, defaultValue) =>
            this._context.t(key, defaultValue),
        );
    }

    private _debouncedSave(key: string, value: string | number | boolean | null): void {
        this._notifyCurrentModuleSettingsChanged();
        this._getAutosaveController().debouncedSave(key, value);
    }

    private _notifyCurrentModuleSettingsChanged(): void {
        const currentModule = this._context.currentModule;
        if (currentModule === undefined) {
            return;
        }

        this._deps.onModuleSettingsChanged(currentModule);
    }

    private _resetAutosaveState(): void {
        this._getAutosaveController().reset();
    }

    private _showSaveIndicator(): void {
        this._getAutosaveController().showPending();
    }

    private _showSaveErrorIndicator(): void {
        this._getAutosaveController().showError();
    }

    private _hideSaveIndicator(): void {
        this._getAutosaveController().hide();
    }

    private _getAutosaveController(): ModuleSettingsAutosaveController {
        this._autosaveController ??= this._controllerFactory.createAutosaveController();

        return this._autosaveController;
    }

    private _getEngineRenderer(): ModuleSettingsEngineRenderer {
        this._engineRenderer ??= this._controllerFactory.createEngineRenderer();

        return this._engineRenderer;
    }

    private _getCustomUiController(): ModuleSettingsCustomUiController {
        this._customUiController ??= this._controllerFactory.createCustomUiController();

        return this._customUiController;
    }

    private _getSchemaRenderer(): ModuleSettingsSchemaRenderer {
        this._schemaRenderer ??= this._controllerFactory.createSchemaRenderer();

        return this._schemaRenderer;
    }
}
