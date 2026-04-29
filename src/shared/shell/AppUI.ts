import type { IApp } from '../types/coreTypes';
import { CategoryKey } from '../types/categoryKeys';
import { appendCustomProviderApps } from '../utils/customProviderSupport';
import { isAiCategory } from '../utils/moduleCategoryPolicy';
import type { EventBus } from '../services/EventBus';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

import { AppUiSelectionState } from './ui/AppUiSelectionState';
import { AppUiChrome } from './ui/AppUiChrome';
import { AppUiActionFeedbackController } from './ui/AppUiActionFeedbackController';
import { AppUiCardActionFlow } from './ui/AppUiCardActionFlow';
import { AppUiDashboardSupport } from './ui/AppUiDashboardSupport';
import { AppUiLifecycleBindings } from './ui/AppUiLifecycleBindings';
import { AppUiModuleFlow } from './ui/AppUiModuleFlow';
import { AppUiModuleLifecycle } from './ui/AppUiModuleLifecycle';
import { AppUiSelectionFlow } from './ui/AppUiSelectionFlow';
import { ModalManager } from './ui/ModalManager';
import { ModuleCardRenderer } from './ui/ModuleCardRenderer';
import { SkeletonManager } from './ui/SkeletonManager';
import { ToastManager } from './ui/ToastManager';
import type { ModulePlatformService } from '../services/ModulePlatformService';
import { type NavigationService } from '@/infrastructure/navigation/NavigationService';

type AppUIStateDeps = {
    removeSelectedModule: (category: string) => void;
    setSelectedModule: (category: string, moduleData: Partial<IApp>) => void;
};

type AppUIDeps = {
    tracer: LoggerService;
    uiState: AppUIStateDeps;
    launchApp: (category: string, app: IApp) => Promise<void>;
    openModuleSettings: (app: IApp) => void;
    stopAiProvider: () => void;
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
    private readonly _dashboardSupport: AppUiDashboardSupport;
    private readonly _skeletonManager: SkeletonManager;
    private readonly _actionFeedbackController: AppUiActionFeedbackController;
    private readonly _cardActionFlow: AppUiCardActionFlow;
    private readonly _lifecycleBindings: AppUiLifecycleBindings;
    private readonly _moduleFlow: AppUiModuleFlow;
    private readonly _moduleLifecycle: AppUiModuleLifecycle;
    private readonly _selectionFlow: AppUiSelectionFlow;
    private readonly _platformService: ModulePlatformService;
    private readonly _deps: AppUIDeps;
    private readonly _selectionState = new AppUiSelectionState();
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
        this._chrome = new AppUiChrome(this._translate, this._deps.tracer);
        this._toastManager = new ToastManager();
        this._cardRenderer = new ModuleCardRenderer({
            checkInstalled: async (moduleId) =>
                await this._platformService.checkInstalled(moduleId),
            translate: this._translate,
            tracer: this._deps.tracer,
            openModuleSettings: (app) => {
                this._deps.openModuleSettings(app);
            },
            getDownloadState: (moduleId) => this._platformService.getDownloadState(moduleId),
        });
        this._dashboardSupport = new AppUiDashboardSupport({
            tracer: this._deps.tracer,
            chrome: this._chrome,
            cardRenderer: this._cardRenderer,
            selectionState: this._selectionState,
            isApiModule: (app) => this._platformService.isApiModule(app),
            openModuleSettings: (app) => {
                this._deps.openModuleSettings(app);
            },
            clearModuleCard: (category) => this.clearModuleCard(category),
            removeSelectedModule: (category) => {
                this._deps.uiState.removeSelectedModule(category);
            },
            stopSelectedApp: (app, category) => this._platformService.stop(app, category),
            openAppSelection: (category) => this.openAppSelection(category),
            updateMultiSlotBadge: () => this._updateMultiSlotBadge(),
            activateAiSlot: (category, app) => {
                this._selectionFlow.activateExistingSelection(category, app);
            },
        });
        this._skeletonManager = new SkeletonManager();
        this._actionFeedbackController = new AppUiActionFeedbackController(this._chrome);
        this._modalManager = new ModalManager(
            this._cardRenderer,
            async (e, app, category) => await this._handleAppCardClick(e, app, category),
            (capability) => this._selectionState.get(`ai_${capability}`)?.id ?? null,
            async (app, category, btn) =>
                await this._moduleFlow.handleDownloadModule(app, category, btn),
            async (app) => {
                await this._platformService.cancelDownload(app.id);
            },
            this._translate,
            this._deps.tracer,
            this._navigation,
            async (app) => {
                await this._platformService.pauseDownload(app.id);
            },
            async (app) => {
                await this._platformService.resumeDownload(app.id);
            },
        );
        this._moduleFlow = new AppUiModuleFlow({
            platformService: this._platformService,
            tracer: this._deps.tracer,
            modalManager: this._modalManager,
            getCatalogApps: (category) => this._getCatalogApps(category),
            getSelectedAppId: (category) => this._selectionState.get(category)?.id ?? null,
            clearModuleCard: (category) => this.clearModuleCard(category),
            markSlotCardAsInstalled: (card, app) =>
                this._dashboardSupport.markSlotCardAsInstalled(card, app),
            showToast: (message, type = 'info') => this.showToast(message, type),
            translate: this._translate,
        });
        this._cardActionFlow = new AppUiCardActionFlow({
            platformService: this._platformService,
            tracer: this._deps.tracer,
            isComingSoonApp: (app) => this._isComingSoonApp(app),
            showComingSoonToast: () => this._showComingSoonToast(),
            showToast: (message, type = 'info') => this.showToast(message, type),
            handleDeleteModule: async (app, category) =>
                await this._handleDeleteModule(app, category),
            handleDownloadModule: (app, category, btn) =>
                this._moduleFlow.handleDownloadModule(app, category, btn),
            pauseDownload: (moduleId) => this._platformService.pauseDownload(moduleId),
            resumeDownload: (moduleId) => this._platformService.resumeDownload(moduleId),
            cancelDownload: (moduleId) => this._platformService.cancelDownload(moduleId),
            resetDownloadButton: (btn) => this._moduleFlow.resetDownloadButton(btn),
            restoreDownloadButtonLabel: (btn) => this._moduleFlow.restoreDownloadButtonLabel(btn),
            performSelectionAction: (category, app) => this._performSelectionAction(category, app),
            translate: this._translate,
        });
        this._moduleLifecycle = new AppUiModuleLifecycle({
            platformService: this._platformService,
            tracer: this._deps.tracer,
            getSelectedApp: (category) => this._selectionState.get(category),
            isSelectedInAnotherAiSlot: (category, appId) =>
                this._selectionState.isSelectedInAnotherAiSlot(category, appId),
            resolveAppById: (appId) => this._resolveAppById(appId),
            updateRuntimeStatus: (category, app, status) => {
                this._dashboardSupport.updateRuntimeStatus(category, app, status);
            },
            translate: this._translate,
            showToast: (message, type = 'info') => this.showToast(message, type),
        });
        this._selectionFlow = new AppUiSelectionFlow({
            getSelectedApp: (category) => this._selectionState.get(category),
            clearModuleCard: (category) => this.clearModuleCard(category),
            updateModuleCard: (category, app) => this.updateModuleCard(category, app),
            updateModalSelection: (appId) => this._modalManager.updateSelection(appId),
            bumpLaunchSelectionVersion: (category) =>
                this._moduleLifecycle.bumpLaunchSelectionVersion(category),
            stopSelectedApp: (app, category) => this._platformService.stop(app, category),
            launchSelectedApp: (category, app, launchSelectionVersion, launchApp) =>
                this._moduleLifecycle.launchSelectedApp(
                    category,
                    app,
                    launchSelectionVersion,
                    launchApp,
                ),
            removeSelectedModule: (category) => {
                this._deps.uiState.removeSelectedModule(category);
            },
            setSelectedModule: (category, moduleData) => {
                this._deps.uiState.setSelectedModule(category, moduleData);
            },
            launchApp: (category, app) => this._deps.launchApp(category, app),
        });
        this._lifecycleBindings = new AppUiLifecycleBindings({
            eventBus: this._eventBus,
            onLanguageChanged: () => {
                this._modalManager.refreshCurrentSelection();
            },
            onPageChange: ({ pageId }) => {
                if (pageId !== 'modules' && pageId !== 'page-modules') {
                    this.closeAppSelection();
                }
            },
        });

        this._initDashboardCardListeners();
    }

    public destroy(): void {
        this._dashboardSupport.cancelPendingSwitch();
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
        this._dashboardSupport.initListeners();
    }

    private _removeDashboardCardListeners(): void {
        this._dashboardSupport.destroy();
    }

    // --- Toast System ---
    /**
     * Shows a toast notification.
     * @param {string} message - The message to display.
     * @param {string} [type='info'] - The toast type (success, error, warning, info).
     * @param {number} [duration=3000] - Duration in milliseconds.
     * @param {string|null} [title=null] - Optional toast title.
     * @param {string|null} [id=null] - Optional unique ID to prevent duplicates.
     * @param {Function|null} [onClick=null] - Optional click handler.
     */
    public showToast(
        message: string,
        type = 'info',
        duration = 3000,
        title: string | null = null,
        id: string | null = null,
        onClick: (() => void) | null = null,
    ): void {
        this._toastManager.show(message, type, duration, title, id, onClick);
    }

    // --- Action Feedback ---
    /**
     * Shows a brief visual feedback for an action.
     * @param {string} [type='success'] - The feedback type.
     */
    public showActionFeedback(type = 'success'): void {
        this._actionFeedbackController.show(type as 'success' | 'error' | 'warning' | 'info');
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
        const card = this._dashboardSupport.getDashboardCard(category);
        if (!(card instanceof HTMLElement)) {
            const cardId = this._dashboardSupport.getCardId(category);
            this._deps.tracer.warn(`[AppUI] Could not find module card: ${cardId}`);
            return;
        }

        this._dashboardSupport.cancelPendingSwitch();
        this._dashboardSupport.applySelectedCardState(card, app, category);
        this._selectionState.set(category, app);
        this._updateMultiSlotBadge();
    }

    /**
     * Clears a specific module card on the dashboard, restoring its default SVG and textual state.
     * @param {string} category - The module category.
     */
    public clearModuleCard(category: string): void {
        const card = this._dashboardSupport.getDashboardCard(category);
        if (!(card instanceof HTMLElement)) return;

        this._dashboardSupport.cancelPendingSwitch();
        this._moduleLifecycle.bumpLaunchSelectionVersion(category);

        const currentApp = this._selectionState.get(category);
        if (currentApp) {
            this._stopRemovedModule(category, currentApp);
            this._selectionState.delete(category);
        }

        if (isAiCategory(category)) {
            const otherSlot = this._selectionState.getOtherAiSlot(category);
            const otherApp = this._selectionState.get(otherSlot);
            if (otherApp) {
                this._dashboardSupport.applySelectedCardState(card, otherApp, otherSlot);
                this._selectionFlow.activateExistingSelection(
                    otherSlot as 'ai_text' | 'ai_image',
                    otherApp,
                );
            } else {
                this._dashboardSupport.resetCardToEmpty(card);
            }
        } else {
            this._dashboardSupport.resetCardToEmpty(card);
        }

        this._stopAiProviderIfNoSlots(category);
        this._updateMultiSlotBadge();
    }

    private _stopRemovedModule(category: string, app: IApp): void {
        if (this._selectionState.shouldKeepRemovedAiAppRunning(category, app)) {
            return;
        }

        void this._platformService.stop(app, category).catch((err: unknown) => {
            this._deps.tracer.warn(
                `[AppUI] Failed to stop removed module ${app.id}: ${String(err)}`,
            );
        });
    }

    /** Stops the AI provider when all AI capability slots are empty. */
    private _stopAiProviderIfNoSlots(category: string): void {
        if (!isAiCategory(category)) return;
        if (!this._selectionState.hasAnyAiSlot()) {
            this._deps.stopAiProvider();
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
        this._dashboardSupport.updateMultiSlotBadge();
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
        return this._dashboardSupport.resolveModalCategory(category);
    }

    private _resolveModalCatalogApps(category: string): IApp[] {
        return this._getCatalogApps(this._dashboardSupport.resolveCatalogCategory(category));
    }

    public getPreferredAiCategory(): 'ai_text' | 'ai_image' {
        const card = this._dashboardSupport.getDashboardCard(CategoryKey.AI_TEXT);
        if (card instanceof HTMLElement) {
            const resolvedCategory = this._selectionState.resolveCategoryFromCard(card);
            if (resolvedCategory === CategoryKey.AI_IMAGE) {
                return CategoryKey.AI_IMAGE;
            }
        }

        if (this._selectionState.has(CategoryKey.AI_TEXT)) {
            return CategoryKey.AI_TEXT;
        }

        if (this._selectionState.has(CategoryKey.AI_IMAGE)) {
            return CategoryKey.AI_IMAGE;
        }

        return CategoryKey.AI_TEXT;
    }

    private _getCatalogApps(category: string): IApp[] {
        try {
            const apps = this._catalogResolver(category);
            return category === CategoryKey.AI ? appendCustomProviderApps(apps) : apps;
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
