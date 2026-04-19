import type { IApp } from '../types/coreTypes';
import type { EventBus } from '../services/EventBus';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

import type { ToastManager } from './ui/ToastManager';
import type { AppUiChrome } from './ui/AppUiChrome';
import type { AppUiActionFeedbackController } from './ui/AppUiActionFeedbackController';
import type { AppUiCardActionFlow } from './ui/AppUiCardActionFlow';
import type { AppUiDashboardController } from './ui/AppUiDashboardController';
import type { AppUiLifecycleBindings } from './ui/AppUiLifecycleBindings';
import type { AppUiModuleFlow } from './ui/AppUiModuleFlow';
import type { AppUiModuleLifecycle } from './ui/AppUiModuleLifecycle';
import type { AppUiSelectionFlow } from './ui/AppUiSelectionFlow';
import { AppUiSelectionState } from './ui/AppUiSelectionState';
import type { AppUiDashboardCardView } from './ui/AppUiDashboardCardView';
import type { ModuleCardRenderer } from './ui/ModuleCardRenderer';
import type { ModalManager } from './ui/ModalManager';
import type { SkeletonManager } from './ui/SkeletonManager';
import { AppUiControllerFactory } from './ui/AppUiControllerFactory';
import type { ModulePlatformService } from '../services/ModulePlatformService';
import { type NavigationService } from '@/infrastructure/navigation/NavigationService';

type AppUIStateDeps = {
    removeSelectedModule: (category: string) => void;
    setSelectedModule: (category: string, moduleData: Partial<IApp>) => void;
    updateState: (updates: { last_active_provider: string | null }) => void;
};

type AppUIDeps = {
    tracer: LoggerService;
    uiState: AppUIStateDeps;
    launchApp: (moduleId: string) => Promise<void>;
    openModuleSettings: (app: IApp) => void;
    stopAiProvider: () => void;
};

type AppUiFactoryCore = {
    platformService: ModulePlatformService;
    navigation: NavigationService;
    eventBus: EventBus;
    catalogResolver: (category: string) => IApp[];
    translate: (key: string, fallback: string) => string;
    deps: AppUIDeps;
    selectionState: AppUiSelectionState;
};

/**
 * @class AppUI
 * @description Facade for UI components. Delegates to specific managers.
 */

// Note: Window interface extensions are defined in core.ts

export class AppUI {
    private readonly _chrome: AppUiChrome;
    private readonly _toastManager: ToastManager;
    private readonly _modalManager: ModalManager;
    private readonly _cardRenderer: ModuleCardRenderer;
    private readonly _dashboardController: AppUiDashboardController;
    private readonly _skeletonManager: SkeletonManager;
    private readonly _actionFeedbackController: AppUiActionFeedbackController;
    private readonly _cardActionFlow: AppUiCardActionFlow;
    private readonly _lifecycleBindings: AppUiLifecycleBindings;
    private readonly _moduleFlow: AppUiModuleFlow;
    private readonly _moduleLifecycle: AppUiModuleLifecycle;
    private readonly _selectionFlow: AppUiSelectionFlow;
    private readonly _dashboardCardView: AppUiDashboardCardView;
    private readonly _platformService: ModulePlatformService;
    private readonly _deps: AppUIDeps;
    private readonly _selectionState = new AppUiSelectionState();
    private readonly _factory = new AppUiControllerFactory();
    public get _selectedApps(): Map<string, IApp> {
        return this._selectionState.asMap();
    }

    constructor(
        platformService: ModulePlatformService,
        private readonly _navigation: NavigationService,
        private readonly _eventBus: EventBus,
        private readonly _catalogResolver: (category: string) => IApp[],
        private readonly _translate: (key: string, fallback: string) => string,
        deps: AppUIDeps,
    ) {
        this._platformService = platformService;
        this._deps = deps;
        const factoryCore = this._createFactoryCore();
        this._chrome = this._factory.createChrome(factoryCore);
        this._toastManager = this._factory.createToastManager();
        this._cardRenderer = this._factory.createCardRenderer(factoryCore);
        this._dashboardController = this._factory.createDashboardController(
            factoryCore,
            this._chrome,
            this._cardRenderer,
            this._createDashboardControllerBridge(),
        );
        this._dashboardCardView = this._factory.createDashboardCardView(
            factoryCore,
            this._chrome,
            this._cardRenderer,
            this._createDashboardCardViewBridge(),
        );
        this._skeletonManager = this._factory.createSkeletonManager();
        this._actionFeedbackController = this._factory.createActionFeedbackController(this._chrome);
        this._modalManager = this._factory.createModalManager(factoryCore, this._cardRenderer, {
            handleAppCardClick: async (e, app, category) =>
                await this._handleAppCardClick(e, app, category),
        });
        this._moduleFlow = this._factory.createModuleFlow(
            factoryCore,
            this._modalManager,
            this._dashboardCardView,
            this._createModuleFlowBridge(),
        );
        this._cardActionFlow = this._factory.createCardActionFlow(factoryCore, this._moduleFlow, {
            isComingSoonApp: (app) => this._isComingSoonApp(app),
            showComingSoonToast: () => this._showComingSoonToast(),
            showToast: (message, type = 'info') => this.showToast(message, type),
            handleDeleteModule: async (app, category) =>
                await this._handleDeleteModule(app, category),
            performSelectionAction: (category, app) => this._performSelectionAction(category, app),
        });
        this._moduleLifecycle = this._factory.createModuleLifecycle(factoryCore, {
            resolveAppById: (appId) => this._resolveAppById(appId),
            showToast: (message, type = 'info') => this.showToast(message, type),
        });
        this._selectionFlow = this._factory.createSelectionFlow(
            factoryCore,
            this._moduleLifecycle,
            this._modalManager,
            this._createSelectionFlowBridge(),
        );
        this._lifecycleBindings = this._factory.createLifecycleBindings(
            factoryCore,
            this._modalManager,
            this._createLifecycleBindingsBridge(),
        );

        this._initDashboardCardListeners();
    }

    private _createFactoryCore(): AppUiFactoryCore {
        return {
            platformService: this._platformService,
            navigation: this._navigation,
            eventBus: this._eventBus,
            catalogResolver: this._catalogResolver,
            translate: this._translate,
            deps: this._deps,
            selectionState: this._selectionState,
        };
    }

    private _createDashboardControllerBridge(): {
        clearModuleCard: (category: string) => void;
        openAppSelection: (category: string) => void;
        updateMultiSlotBadge: () => void;
    } {
        return {
            clearModuleCard: (category) => this.clearModuleCard(category),
            openAppSelection: (category) => this.openAppSelection(category),
            updateMultiSlotBadge: () => this._updateMultiSlotBadge(),
        };
    }

    private _createDashboardCardViewBridge(): {
        clearModuleCard: (category: string) => void;
    } {
        return {
            clearModuleCard: (category) => this.clearModuleCard(category),
        };
    }

    private _createModuleFlowBridge(): {
        clearModuleCard: (category: string) => void;
        openAppSelection: (category: string, apps?: IApp[]) => void;
        showToast: (message: string, type?: string) => void;
    } {
        return {
            clearModuleCard: (category) => this.clearModuleCard(category),
            openAppSelection: (category, apps) => this.openAppSelection(category, apps),
            showToast: (message, type = 'info') => this.showToast(message, type),
        };
    }

    private _createSelectionFlowBridge(): {
        clearModuleCard: (category: string) => void;
        updateModuleCard: (category: string, app: IApp) => void;
    } {
        return {
            clearModuleCard: (category) => this.clearModuleCard(category),
            updateModuleCard: (category, app) => this.updateModuleCard(category, app),
        };
    }

    private _createLifecycleBindingsBridge(): {
        closeAppSelection: () => void;
    } {
        return {
            closeAppSelection: () => this.closeAppSelection(),
        };
    }

    public destroy(): void {
        this._dashboardController.cancelPendingSwitch();
        this._actionFeedbackController.clear();
        this._selectionState.clear();
        this._lifecycleBindings.destroy();
        this._removeDashboardCardListeners();
        this._modalManager.destroy();
    }

    /**
     * Initializes permanent listeners for dashboard cards to handle interactions safely.
     */
    private _initDashboardCardListeners(): void {
        this._dashboardController.initListeners();
    }

    private _removeDashboardCardListeners(): void {
        this._dashboardController.destroy();
    }

    // --- Toast System ---
    /**
     * Shows a toast notification.
     * @param {string} message - The message to display.
     * @param {string} [type='info'] - The toast type (success, error, warning, info).
     * @param {number} [duration=3000] - Duration in milliseconds.
     * @param {string|null} [title=null] - Optional toast title.
     * @param {string|null} [id=null] - Optional unique ID to prevent duplicates.
     */
    public showToast(
        message: string,
        type = 'info',
        duration = 3000,
        title: string | null = null,
        id: string | null = null,
    ): void {
        this._toastManager.show(message, type, duration, title, id);
    }

    // --- Action Feedback ---
    /**
     * Shows a brief visual feedback for an action.
     * @param {string} [type='success'] - The feedback type.
     */
    public showActionFeedback(type = 'success'): void {
        this._actionFeedbackController.show(
            type as 'success' | 'error' | 'warning' | 'info',
        );
    }

    // --- Skeletons ---
    /**
     * Displays skeleton loaders for a container.
     * @param {string} containerId - The ID of the container.
     * @param {number} [count=3] - Number of skeletons to show.
     */
    public showSkeletonLoaders(containerId: string, count = 3): void {
        this._skeletonManager.show(containerId, count);
    }

    public hideSkeletonLoaders(containerId: string, count = 3): void {
        this._skeletonManager.hide(containerId, count);
    }

    // --- Button State ---
    /**
     * Toggles the loading state of a button.
     * @param {HTMLButtonElement | null} button - The button to modify.
     * @param {boolean} [loading=true] - Whether it should be in loading state.
     */
    public setButtonLoading(button: HTMLButtonElement | null, loading = true): void {
        this._skeletonManager.setButtonLoading(button, loading);
    }
    /**
     * Opens the app selection modal for a specific category.
     * @param {string} category - 'ai' or 'services'.
     * @param {IApp[]} [apps] - List of apps to display.
     */
    public openAppSelection(category: string, apps?: IApp[]): void {
        const modalCategory = this._resolveModalCategory(category);
        const appsToRender = apps ?? this._resolveModalCatalogApps(category);
        const selectedId = this._selectionState.getModalSelectedId(modalCategory);

        this._modalManager.openAppSelection(modalCategory, appsToRender, selectedId);
    }

    public closeAppSelection(): void {
        this._modalManager.closeAppSelection();
    }

    /**
     * Updates a specific module card on the dashboard.
     * @param {string} category - The module category.
     * @param {IApp} app - The app data.
     */
    public updateModuleCard(category: string, app: IApp): void {
        const card = this._dashboardCardView.getDashboardCard(category);
        if (!(card instanceof HTMLElement)) {
            const cardId = this._dashboardCardView.getCardId(category);
            this._deps.tracer.warn(`[AppUI] Could not find module card: ${cardId}`);
            return;
        }

        this._dashboardController.cancelPendingSwitch();
        this._moduleLifecycle.stopPreviousModule(card, app, category);
        this._dashboardCardView.applySelectedCardState(card, app, category);
        this._selectionState.set(category, app);
        this._updateMultiSlotBadge();
    }

    /**
     * Clears a specific module card on the dashboard, restoring its default SVG and textual state.
     * @param {string} category - The module category.
     */
    public clearModuleCard(category: string): void {
        const card = this._dashboardCardView.getDashboardCard(category);
        if (!(card instanceof HTMLElement)) return;

        this._dashboardController.cancelPendingSwitch();
        this._moduleLifecycle.bumpLaunchSelectionVersion(category);

        const currentApp = this._selectionState.get(category);
        if (currentApp) {
            this._stopRemovedModule(category, currentApp);
            this._selectionState.delete(category);
        }

        if (category.startsWith('ai')) {
            const otherSlot = this._selectionState.getOtherAiSlot(category);
            const otherApp = this._selectionState.get(otherSlot);
            if (otherApp) {
                this._dashboardCardView.applySelectedCardState(card, otherApp, otherSlot);
            } else {
                this._dashboardCardView.resetCardToEmpty(card);
            }
        } else {
            this._dashboardCardView.resetCardToEmpty(card);
        }

        this._stopAiProviderIfNoSlots(category);
        this._updateMultiSlotBadge();
    }

    private _stopRemovedModule(category: string, app: IApp): void {
        if (this._selectionState.shouldKeepRemovedAiAppRunning(category, app)) {
            return;
        }

        void this._platformService.stop(app).catch((err: unknown) => {
            this._deps.tracer.warn(`[AppUI] Failed to stop removed module ${app.id}: ${String(err)}`);
        });
    }

    /** Stops the AI provider when all AI capability slots are empty. */
    private _stopAiProviderIfNoSlots(category: string): void {
        if (!category.startsWith('ai')) return;
        if (!this._selectionState.hasAnyAiSlot()) {
            this._deps.stopAiProvider();
            this._deps.uiState.updateState({ last_active_provider: null });
        }
    }

    /**
     * Injects or removes the multi-slot badge on #ai-module-card.
     * The badge uses the same module-action-badge system as ⚙️ and ✕ buttons:
     *   - Appears on card hover (opacity controlled by CSS)
     *   - Compact "+1" at rest, expands LEFT to show secondary engine name on hover
     *   - Purple accent to indicate "extra capability" (not a danger/action intent)
     */
    private _updateMultiSlotBadge(): void {
        this._dashboardController.updateMultiSlotBadge();
    }

    // --- Private Helper Methods ---

    // _getSortedApps removed (delegated to ModalManager)

    // _createAppCard removed (delegated to ModuleCardRenderer)

    private async _handleAppCardClick(e: MouseEvent, app: IApp, category: string): Promise<void> {
        await this._cardActionFlow.handleAppCardClick(e, app, category);
    }

    private _performSelectionAction(category: string, app: IApp): void {
        if (this._isComingSoonApp(app)) {
            this._showComingSoonToast();
            return;
        }
        this._selectionFlow.performSelectionAction(category, app);
    }

    private async _handleDeleteModule(app: IApp, category: string): Promise<void> {
        await this._moduleFlow.handleDeleteModule(app, category);
    }

    public _onModalDownloadSuccess(btn: HTMLElement | null, app: IApp, category: string): void {
        this._moduleFlow.onModalDownloadSuccess(btn, app, category);
    }

    public _onModalDownloadError(btn: HTMLElement | null, err: unknown): void {
        this._moduleFlow.onModalDownloadError(btn, err);
    }

    private _resolveAppById(appId: string): IApp | undefined {
        for (const selectedApp of this._selectionState.values()) {
            if (selectedApp.id === appId) {
                return selectedApp;
            }
        }

        const allApps = [...this._getCatalogApps('ai'), ...this._getCatalogApps('services')];
        return allApps.find((catalogApp) => catalogApp.id === appId);
    }

    private _resolveModalCategory(category: string): string {
        return this._dashboardCardView.resolveModalCategory(category);
    }

    private _resolveModalCatalogApps(category: string): IApp[] {
        return this._getCatalogApps(this._dashboardCardView.resolveCatalogCategory(category));
    }

    public _resolveCategoryFromCard(card: HTMLElement): string {
        const currentCapability = card.dataset['currentCapability'];
        if (typeof currentCapability === 'string' && currentCapability !== '') {
            return currentCapability;
        }

        return card.id === 'ai-module-card' ? 'ai_text' : 'services';
    }

    private _getCatalogApps(category: string): IApp[] {
        try {
            return this._catalogResolver(category);
        } catch (err: unknown) {
            this._deps.tracer.warn(
                `[AppUI] Failed to read catalog category ${category}: ${String(err)}`,
            );
            return [];
        }
    }

    private _isComingSoonApp(app: IApp): boolean {
        return app.comingSoon === true;
    }

    private _showComingSoonToast(): void {
        this.showToast(
            this._chrome.translate(
                'ui.launcher.module.coming_soon_detail',
                'This integration is planned and will arrive in a future update.',
            ),
            'info',
        );
    }

}
