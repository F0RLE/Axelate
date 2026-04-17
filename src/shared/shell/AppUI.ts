import type { IApp } from '../types/coreTypes';
import { getGlobalWin } from '../utils/globalAccessor';
import { eventBus } from '../services/EventBus';
import { tracer } from '@/infrastructure/logging/LoggerService';

import { ToastManager } from './ui/ToastManager';
import { AppUiChrome } from './ui/AppUiChrome';
import { AppUiCardActionFlow } from './ui/AppUiCardActionFlow';
import { AppUiModuleFlow } from './ui/AppUiModuleFlow';
import { AppUiModuleLifecycle } from './ui/AppUiModuleLifecycle';
import { AppUiSelectionFlow } from './ui/AppUiSelectionFlow';
import { AppUiSelectionState } from './ui/AppUiSelectionState';
import { ModuleCardRenderer } from './ui/ModuleCardRenderer';
import { ModalManager } from './ui/ModalManager';
import { SkeletonManager } from './ui/SkeletonManager';
import type { ModulePlatformService } from '../services/ModulePlatformService';
import { type NavigationService } from '@/infrastructure/navigation/NavigationService';

/**
 * @class AppUI
 * @description Facade for UI components. Delegates to specific managers.
 */

// Note: Window interface extensions are defined in core.ts

export class AppUI {
    // Managers
    private readonly _chrome: AppUiChrome;
    private readonly _toastManager: ToastManager;
    private readonly _modalManager: ModalManager;
    private readonly _cardRenderer: ModuleCardRenderer;
    private readonly _skeletonManager: SkeletonManager;
    private readonly _cardActionFlow: AppUiCardActionFlow;
    private readonly _moduleFlow: AppUiModuleFlow;
    private readonly _moduleLifecycle: AppUiModuleLifecycle;
    private readonly _selectionFlow: AppUiSelectionFlow;
    private readonly _platformService: ModulePlatformService;
    private readonly _selectionState = new AppUiSelectionState();
    private _pendingDashboardSwitchTimer: ReturnType<typeof setTimeout> | null = null;
    private _pendingDashboardSwitchCard: HTMLElement | null = null;
    private _actionFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly _boundLanguageChanged = () => {
        this._modalManager.refreshCurrentSelection();
    };
    private readonly _boundPageChange = ({ pageId }: { pageId: string }) => {
        if (pageId !== 'modules' && pageId !== 'page-modules') {
            this.closeAppSelection();
        }
    };
    private readonly _boundDashboardContextMenu = (e: Event) => {
        const target = e.target as HTMLElement;
        const card = target.closest('#ai-module-card, #services-module-card');
        if (!(card instanceof HTMLElement)) return;
        if (!card.classList.contains('selected')) return;

        const category = this._resolveCategoryFromCard(card);
        const app = this._selectionState.get(category);
        if (app === undefined) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        tracer.info(`[AppUI] Right-click settings for ${category}:`, app.id);
        const win = getGlobalWin();
        if (typeof win.openModuleSettings === 'function') {
            win.openModuleSettings(app);
        }
    };
    private readonly _boundDashboardMouseDown = (e: Event) => {
        const mouseEvent = e as MouseEvent;
        const target = mouseEvent.target as HTMLElement;
        const card = target.closest('#ai-module-card, #services-module-card');
        if (!(card instanceof HTMLElement)) return;
        if (!card.classList.contains('selected')) return;

        if (mouseEvent.button === 1) {
            mouseEvent.preventDefault();
            mouseEvent.stopPropagation();
            const category = this._resolveCategoryFromCard(card);
            tracer.info(`[AppUI] Middle-click close for ${category}`);
            this.clearModuleCard(category);
            getGlobalWin().uiState.removeSelectedModule(category);
        } else if (mouseEvent.button === 2) {
            mouseEvent.stopPropagation();
            mouseEvent.stopImmediatePropagation();
        }
    };
    private readonly _boundDashboardWheel = (e: Event) => {
        const wheelEvent = e as WheelEvent;
        const target = wheelEvent.target as HTMLElement;
        const card = target.closest<HTMLElement>('#ai-module-card');
        if (card?.classList.contains('selected') !== true) return;

        const textApp = this._selectionState.get('ai_text');
        const imageApp = this._selectionState.get('ai_image');
        if (textApp === undefined || imageApp === undefined) return;

        const shownModule = card.dataset['currentModule'];
        const nextCategory = wheelEvent.deltaY < 0 ? 'ai_text' : 'ai_image';
        const nextApp = nextCategory === 'ai_text' ? textApp : imageApp;
        if (shownModule === nextApp.id) return;

        wheelEvent.preventDefault();
        this._cancelPendingDashboardSwitch();

        card.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateY(4px)';
        this._pendingDashboardSwitchCard = card;

        this._pendingDashboardSwitchTimer = setTimeout(() => {
            this._pendingDashboardSwitchTimer = null;
            this._pendingDashboardSwitchCard = null;

            const currentNextApp = this._selectionState.get(nextCategory);
            if (
                !card.isConnected ||
                !card.classList.contains('selected') ||
                currentNextApp?.id !== nextApp.id
            ) {
                this._resetDashboardSwitchStyles(card);
                return;
            }

            this._cardRenderer.updateCardContent(card, nextApp);
            this._cardRenderer.updateCardAttributes(card, nextApp, nextCategory);
            this._updateMultiSlotBadge();
            this._resetDashboardSwitchStyles(card);
        }, 150);
    };
    private readonly _pageChangeUnsub: () => void;
    public get _selectedApps(): Map<string, IApp> {
        return this._selectionState.asMap();
    }

    constructor(
        platformService: ModulePlatformService,
        private readonly _navigation: NavigationService,
        private readonly _catalogResolver: (category: string) => IApp[],
    ) {
        this._platformService = platformService;
        this._chrome = new AppUiChrome();
        this._toastManager = new ToastManager();
        this._cardRenderer = new ModuleCardRenderer();
        this._skeletonManager = new SkeletonManager();
        this._modalManager = new ModalManager(
            this._cardRenderer,
            (e, app, category) => {
                void this._handleAppCardClick(e, app, category);
            },
            // When user switches tab in modal, return the previously-selected app ID for that slot
            (capability) => this._selectionState.get(`ai_${capability}`)?.id ?? null,
            async (app) => await this._platformService.download(app),
            async (app) => {
                await this._platformService.cancelDownload(app.id);
                await this._platformService.delete(app);
            },
            this._navigation,
        );
        this._moduleFlow = new AppUiModuleFlow({
            platformService: this._platformService,
            modalManager: this._modalManager,
            getCatalogApps: (category) => this._getCatalogApps(category),
            getSelectedAppId: (category) => this._selectionState.get(category)?.id ?? null,
            clearModuleCard: (category) => this.clearModuleCard(category),
            openAppSelection: (category, apps) => this.openAppSelection(category, apps),
            markCardAsInstalled: (card, app) => this._markCardAsInstalled(card, app),
            showToast: (message, type = 'info') => this.showToast(message, type),
        });
        this._cardActionFlow = new AppUiCardActionFlow({
            platformService: this._platformService,
            isComingSoonApp: (app) => this._isComingSoonApp(app),
            showComingSoonToast: () => this._showComingSoonToast(),
            showToast: (message, type = 'info') => this.showToast(message, type),
            handleDeleteModule: (app, category) => this._handleDeleteModule(app, category),
            handleDownloadModule: (app, category, btn) =>
                this._moduleFlow.handleDownloadModule(app, category, btn),
            resetDownloadButton: (btn) => this._moduleFlow.resetDownloadButton(btn),
            restoreDownloadButtonLabel: (btn) => this._moduleFlow.restoreDownloadButtonLabel(btn),
            performSelectionAction: (category, app) => this._performSelectionAction(category, app),
        });
        this._moduleLifecycle = new AppUiModuleLifecycle({
            platformService: this._platformService,
            getSelectedApp: (category) => this._selectionState.get(category),
            isSelectedInAnotherAiSlot: (category, appId) =>
                this._selectionState.isSelectedInAnotherAiSlot(category, appId),
            resolveAppById: (appId) => this._resolveAppById(appId),
        });
        this._selectionFlow = new AppUiSelectionFlow({
            getSelectedApp: (category) => this._selectionState.get(category),
            clearModuleCard: (category) => this.clearModuleCard(category),
            updateModuleCard: (category, app) => this.updateModuleCard(category, app),
            updateModalSelection: (appId) => this._modalManager.updateSelection(appId),
            bumpLaunchSelectionVersion: (category) =>
                this._moduleLifecycle.bumpLaunchSelectionVersion(category),
            stopSelectedApp: (app) => this._platformService.stop(app),
            launchSelectedApp: (category, app, launchSelectionVersion, launchApp) =>
                this._moduleLifecycle.launchSelectedApp(
                    category,
                    app,
                    launchSelectionVersion,
                    launchApp,
                ),
        });

        globalThis.addEventListener('language-changed', this._boundLanguageChanged);

        // Close modal when navigating away from modules page
        this._pageChangeUnsub = eventBus.on('page:change', this._boundPageChange);

        this._initDashboardCardListeners();
    }

    public destroy(): void {
        this._cancelPendingDashboardSwitch();
        this._clearActionFeedbackTimer();
        this._selectionState.clear();
        globalThis.removeEventListener('language-changed', this._boundLanguageChanged);
        this._pageChangeUnsub();
        document.body.removeEventListener('contextmenu', this._boundDashboardContextMenu);
        document.body.removeEventListener('mousedown', this._boundDashboardMouseDown);
        document.body.removeEventListener('wheel', this._boundDashboardWheel);
        this._modalManager.destroy();
    }

    /**
     * Initializes permanent listeners for dashboard cards to handle interactions safely.
     */
    private _initDashboardCardListeners(): void {
        document.body.addEventListener('contextmenu', this._boundDashboardContextMenu);
        document.body.addEventListener('mousedown', this._boundDashboardMouseDown);
        document.body.addEventListener('wheel', this._boundDashboardWheel, { passive: false });
    }

    private _resolveCategoryFromCard(card: HTMLElement): string {
        return this._selectionState.resolveCategoryFromCard(card);
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
        const feedback = this._chrome.ensureActionFeedback();

        this._clearActionFeedbackTimer();
        feedback.className = `action-feedback ${type}`;
        const iconElement = feedback.querySelector('.action-feedback-icon');
        if (iconElement !== null) {
            iconElement.textContent = '';
        }
        feedback.classList.add('show');

        const el = feedback;
        this._actionFeedbackTimer = setTimeout(() => {
            this._actionFeedbackTimer = null;
            el.classList.remove('show');
        }, 600);
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
        const rawCategory = category.startsWith('ai') ? 'ai' : category;
        const appsToRender = apps ?? this._getCatalogApps(rawCategory);

        // Preserve AI compound categories for the modal filter tabs.
        // Non-AI categories must keep their own category, otherwise service modals
        // incorrectly show the global AI Text/Image tab row.
        const modalCategory = category === 'ai' ? 'ai_text' : category;
        const selectedId =
            this._selectionState.getModalSelectedId(modalCategory);

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
        // Both 'ai_text' and 'ai_image' map to the same dashboard card
        const cardId = this._categoryToCardId(category);
        const cardLike = document.getElementById(cardId);

        if (cardLike instanceof HTMLElement) {
            this._cancelPendingDashboardSwitch();
            this._moduleLifecycle.stopPreviousModule(cardLike, app, category);
            this._cardRenderer.updateCardAttributes(cardLike, app, category);

            cardLike.classList.remove('empty');
            cardLike.classList.add('selected');

            this._cardRenderer.updateCardContent(cardLike, app);

            this._configureActionBtn(cardLike, app);
            this._refreshCardActions(cardLike, app, category);

            // Store under compound key (ai_text or ai_image)
            this._selectionState.set(category, app);
            this._updateMultiSlotBadge();
        } else {
            tracer.warn(`[AppUI] Could not find module card: ${cardId}`);
        }
    }

    /**
     * Clears a specific module card on the dashboard, restoring its default SVG and textual state.
     * @param {string} category - The module category.
     */
    public clearModuleCard(category: string): void {
        const cardId = this._categoryToCardId(category);
        const cardLike = document.getElementById(cardId);
        if (!(cardLike instanceof HTMLElement)) return;

        this._cancelPendingDashboardSwitch();
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
                // Other AI slot still active — show that engine on the shared AI card
                this._cardRenderer.updateCardContent(cardLike, otherApp);
                this._cardRenderer.updateCardAttributes(cardLike, otherApp, otherSlot);
                this._refreshCardActions(cardLike, otherApp, otherSlot);
            } else {
                this._resetCardToEmpty(cardLike);
            }
        } else {
            this._resetCardToEmpty(cardLike);
        }

        this._stopAiProviderIfNoSlots(category);
        this._updateMultiSlotBadge();
    }

    private _stopRemovedModule(category: string, app: IApp): void {
        if (this._selectionState.shouldKeepRemovedAiAppRunning(category, app)) {
            return;
        }

        void this._platformService.stop(app).catch((err: unknown) => {
            tracer.warn(`[AppUI] Failed to stop removed module ${app.id}: ${String(err)}`);
        });
    }

    /** Resets a card element to its empty visual state (no module selected). */
    private _resetCardToEmpty(card: HTMLElement): void {
        card.classList.remove('selected', 'has-download', 'has-launch');
        card.classList.add('empty');
        delete card.dataset['currentModule'];
        delete card.dataset['currentModuleName'];
        delete card.dataset['currentCapability'];
        const originalHtml = card.dataset['originalHtml'];
        if (originalHtml !== undefined && originalHtml !== '') {
            card.innerHTML = originalHtml;
        }
    }

    private _cancelPendingDashboardSwitch(): void {
        if (this._pendingDashboardSwitchTimer !== null) {
            clearTimeout(this._pendingDashboardSwitchTimer);
            this._pendingDashboardSwitchTimer = null;
        }

        this._resetDashboardSwitchStyles(this._pendingDashboardSwitchCard);
        this._pendingDashboardSwitchCard = null;
    }

    private _resetDashboardSwitchStyles(card: HTMLElement | null): void {
        if (!(card instanceof HTMLElement)) return;

        card.style.removeProperty('transition');
        card.style.removeProperty('opacity');
        card.style.removeProperty('transform');
    }

    private _clearActionFeedbackTimer(): void {
        if (this._actionFeedbackTimer === null) return;

        clearTimeout(this._actionFeedbackTimer);
        this._actionFeedbackTimer = null;
    }

    /** Stops the AI provider when all AI capability slots are empty. */
    private _stopAiProviderIfNoSlots(category: string): void {
        if (!category.startsWith('ai')) return;
        if (!this._selectionState.hasAnyAiSlot()) {
            const win = getGlobalWin();
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- aiBridge is a runtime global
            win.aiBridge?.stopProvider();
            win.uiState.updateState({ last_active_provider: null });
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
        const card = document.getElementById('ai-module-card');
        if (!(card instanceof HTMLElement)) return;

        // Remove existing badge first
        card.querySelector('.module-action-badge.stack')?.remove();

        const sharedAiState = this._selectionState.getSharedAiCardState(card);
        if (sharedAiState === null) return;

        const badge = this._chrome.createStackBadge(
            sharedAiState.secondaryApp.name ?? sharedAiState.secondaryApp.id,
            () => {
                this.openAppSelection(sharedAiState.openCapability);
            },
        );

        card.appendChild(badge);
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

    /**
     * Maps a category key to the corresponding dashboard card element ID.
     * Both 'ai_text' and 'ai_image' map to the same AI card on the dashboard.
     */
    private _categoryToCardId(category: string): string {
        if (category === 'ai' || category.startsWith('ai_')) return 'ai-module-card';
        return 'services-module-card';
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

    private _getCatalogApps(category: string): IApp[] {
        try {
            return this._catalogResolver(category);
        } catch (err: unknown) {
            tracer.warn(`[AppUI] Failed to read catalog category ${category}: ${String(err)}`);
            return [];
        }
    }

    // _updateCardAttributes removed (delegated to ModuleCardRenderer)

    // _markCardAsInstalled delegated
    private _markCardAsInstalled(card: HTMLElement, app: IApp): void {
        this._cardRenderer.markCardAsInstalled(card, app, (c, a) => this._configureActionBtn(c, a));
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

    private _configureActionBtn(card: HTMLElement, app: IApp): void {
        let actionBtn = card.querySelector<HTMLElement>('.model-card-action');

        if (actionBtn === null) {
            actionBtn = document.createElement('div');
            actionBtn.className = 'model-card-action';
            actionBtn.id =
                card.id === 'ai-module-card' ? 'ai-module-add-btn' : 'services-module-add-btn';
            actionBtn.dataset['i18n'] = 'ui.launcher.button.launch';
            card.appendChild(actionBtn);
        }

        const isApi = this._platformService.isApiModule(app);
        const isInstalled = app.installed !== false;

        // Dashboard card never shows a Download button.
        // Downloading is done exclusively from the App Selection Modal.
        // If the app is not installed (and not API), just hide the action button.
        actionBtn.style.display = 'none';
        actionBtn.classList.remove('download-module-btn', 'active-module-btn', 'has-download');

        if (!isApi && !isInstalled) {
            // Module is on the card but not installed — this shouldn't normally happen
            // (selection is blocked in _performSelectionAction) but guard defensively.
            return;
        }
    }

    private _addSettingsBtn(card: HTMLElement, app: IApp): void {
        const settingsBtn = this._chrome.createSettingsBadge(
            app,
            (targetApp) => {
                const win = getGlobalWin();
                if (typeof win.openModuleSettings === 'function') {
                    win.openModuleSettings(targetApp);
                    return;
                }

                tracer.error('[AppUI] globalThis.openModuleSettings is undefined');
            },
        );
        card.appendChild(settingsBtn);
    }

    private _addCloseBtn(card: HTMLElement, category: string): void {
        const closeBtn = this._chrome.createCloseBadge(
            category,
            (resolvedCategory) => {
                this.clearModuleCard(resolvedCategory);
                const globalWin = getGlobalWin();
                globalWin.uiState.removeSelectedModule(resolvedCategory);
            },
        );
        card.appendChild(closeBtn);
    }

    // --- Private Helper Methods ---
    // All previous helper methods have been moved to ModuleCardRenderer or ModalManager.
    // This section is kept for any future AppUI-specific helpers.

    private _refreshCardActions(card: HTMLElement, app: IApp, category: string): void {
        // Remove existing actions
        card.querySelectorAll('.module-action-badge').forEach((el) => {
            el.remove();
        });

        this._addSettingsBtn(card, app);
        this._addCloseBtn(card, category);
    }
}
