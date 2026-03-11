import type { IApp } from '../types/coreTypes';
import { getGlobalWin } from '../utils/globalAccessor';
import DOMPurify from 'dompurify';
import { eventBus } from '../services/EventBus';
import { tracer } from '@/infrastructure/logging/LoggerService';

import { ToastManager } from './ui/ToastManager';
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
    private readonly _purifyConfig = {
        ALLOWED_TAGS: [
            'b',
            'i',
            'em',
            'strong',
            'a',
            'p',
            'br',
            'code',
            'pre',
            'div',
            'span',
            'svg',
            'use',
            'symbol',
            'line',
            'path',
            'polyline',
            'polygon',
            'rect',
            'circle',
            'ellipse',
        ],
        ALLOWED_ATTR: [
            'href',
            'class',
            'style',
            'viewBox',
            'width',
            'height',
            'fill',
            'stroke',
            'stroke-width',
            'stroke-linecap',
            'stroke-linejoin',
            // Shape geometry attributes
            'd',
            'points',
            'x',
            'y',
            'x1',
            'y1',
            'x2',
            'y2',
            'cx',
            'cy',
            'r',
            'rx',
            'ry',
        ],
        ALLOW_DATA_ATTR: true,
    };
    // Managers
    private readonly _toastManager: ToastManager;
    private readonly _modalManager: ModalManager;
    private readonly _cardRenderer: ModuleCardRenderer;
    private readonly _skeletonManager: SkeletonManager;
    private readonly _platformService: ModulePlatformService;
    private readonly _selectedApps = new Map<string, IApp>();

    constructor(
        platformService: ModulePlatformService,
        private readonly _navigation: NavigationService,
    ) {
        this._platformService = platformService;
        this._toastManager = new ToastManager();
        this._cardRenderer = new ModuleCardRenderer();
        this._skeletonManager = new SkeletonManager();
        this._modalManager = new ModalManager(
            this._cardRenderer,
            (e, app, category) => {
                void this._handleAppCardClick(e, app, category);
            },
            // When user switches tab in modal, return the previously-selected app ID for that slot
            (capability) => this._selectedApps.get(`ai_${capability}`)?.id ?? null,
            this._navigation,
        );

        globalThis.addEventListener('language-changed', () => {
            this._modalManager.refreshCurrentSelection();
        });

        // Close modal when navigating away from modules page
        eventBus.on('page:change', ({ pageId }: { pageId: string }) => {
            if (pageId !== 'modules' && pageId !== 'page-modules') {
                this.closeAppSelection();
            }
        });

        this._initDashboardCardListeners();
    }

    /**
     * Initializes permanent listeners for dashboard cards to handle interactions safely.
     */
    private _initDashboardCardListeners(): void {
        const categoryOf = (id: string): string =>
            id === 'ai-module-card' ? 'ai_text' : 'services';

        // Use delegation because module cards live in a template loaded async
        document.body.addEventListener('contextmenu', (e) => {
            const target = e.target as HTMLElement;
            const card = target.closest('#ai-module-card, #services-module-card');
            if (!(card instanceof HTMLElement)) return;
            if (!card.classList.contains('selected')) return;

            let category = categoryOf(card.id);
            let app = this._selectedApps.get(category);

            const shownId = card.dataset['currentModule'];
            if (shownId !== undefined) {
                for (const [cap, a] of this._selectedApps.entries()) {
                    if (a.id === shownId) {
                        category = cap;
                        app = a;
                        break;
                    }
                }
            }

            if (app === undefined) return;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            tracer.info(`[AppUI] Right-click settings for ${category}:`, app.id);
            const win = getGlobalWin();
            if (typeof win.openModuleSettings === 'function') {
                win.openModuleSettings(app);
            }
        });

        document.body.addEventListener('mousedown', (e) => {
            const target = e.target as HTMLElement;
            const card = target.closest('#ai-module-card, #services-module-card');
            if (!(card instanceof HTMLElement)) return;
            if (!card.classList.contains('selected')) return;

            if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
                // Resolve the currently-displayed category from the card's active module
                // (the card might be showing 'ai_image' after 'ai_text' was closed first)
                const shownId = card.dataset['currentModule'];
                let category = categoryOf(card.id);
                if (shownId !== undefined) {
                    for (const [cap, app] of this._selectedApps.entries()) {
                        if (app.id === shownId) {
                            category = cap;
                            break;
                        }
                    }
                }
                tracer.info(`[AppUI] Middle-click close for ${category}`);
                this.clearModuleCard(category);
                getGlobalWin().uiState.removeSelectedModule(category);
            } else if (e.button === 2) {
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        });

        // Scroll wheel on AI card: cycle between ai_text and ai_image slots
        document.body.addEventListener(
            'wheel',
            (e) => {
                const target = e.target as HTMLElement;
                const card = target.closest<HTMLElement>('#ai-module-card');
                if (card?.classList.contains('selected') !== true) return;

                const textApp = this._selectedApps.get('ai_text');
                const imageApp = this._selectedApps.get('ai_image');
                if (textApp === undefined || imageApp === undefined) return; // need both to switch

                const shownModule = card.dataset['currentModule'];
                // scroll up (deltaY < 0) → text, scroll down → image
                const nextApp = e.deltaY < 0 ? textApp : imageApp;
                if (shownModule === nextApp.id) return; // already on that slot

                e.preventDefault();

                card.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
                card.style.opacity = '0';
                card.style.transform = 'translateY(4px)';

                setTimeout(() => {
                    this._cardRenderer.updateCardContent(card, nextApp);
                    this._cardRenderer.updateCardAttributes(card, nextApp);
                    this._updateMultiSlotBadge();
                    card.style.opacity = '1';
                    card.style.transform = 'translateY(0)';
                }, 150);
            },
            { passive: false },
        );
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
        let feedback = document.getElementById('action-feedback');
        if (feedback === null) {
            feedback = document.createElement('div');
            feedback.className = 'action-feedback';
            feedback.id = 'action-feedback';
            const win = getGlobalWin();
            feedback.innerHTML = DOMPurify.sanitize(win.t('ui.feedback', ''), this._purifyConfig);
            document.body.appendChild(feedback);
        }

        feedback.className = `action-feedback ${type}`;
        const iconElement = feedback.querySelector('.action-feedback-icon');
        if (iconElement !== null) {
            iconElement.textContent = '';
        }
        feedback.classList.add('show');

        const el = feedback;
        setTimeout(() => {
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
        let appsToRender = apps;
        if (!appsToRender) {
            const win = getGlobalWin();
            appsToRender = (win.getCatalogCategory as (cat: string) => IApp[])(rawCategory);
        }

        // Pass the compound category ('ai_text' or 'ai_image') to ModalManager so it
        // preserves the correct filter tab. For plain 'ai', default to the text slot.
        const modalCategory = category.startsWith('ai_') ? category : 'ai_text';
        const selectedId =
            this._selectedApps.get(modalCategory)?.id ?? this._selectedApps.get('ai_text')?.id;

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
            this._stopPreviousModule(cardLike, app);
            this._cardRenderer.updateCardAttributes(cardLike, app);

            cardLike.classList.remove('empty');
            cardLike.classList.add('selected');

            this._cardRenderer.updateCardContent(cardLike, app);

            this._configureActionBtn(cardLike, app);
            this._refreshCardActions(cardLike, app, category);

            // Store under compound key (ai_text or ai_image)
            this._selectedApps.set(category, app);
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

        const currentApp = this._selectedApps.get(category);
        if (currentApp) {
            this._stopPreviousModule(cardLike, currentApp);
            this._selectedApps.delete(category);
        }

        // Only visually reset the card if the other AI slot is also empty
        const otherSlot = category === 'ai_text' ? 'ai_image' : 'ai_text';
        const otherApp = this._selectedApps.get(otherSlot);
        if (otherApp) {
            // Other slot still active — show that engine on the card
            this._cardRenderer.updateCardContent(cardLike, otherApp);
            // Re-inject action buttons for the now-active slot so ✕ holds correct category
            this._refreshCardActions(cardLike, otherApp, otherSlot);
        } else {
            this._resetCardToEmpty(cardLike);
        }

        this._stopAiProviderIfNoSlots(category);
        this._updateMultiSlotBadge();
    }

    /** Resets a card element to its empty visual state (no module selected). */
    private _resetCardToEmpty(card: HTMLElement): void {
        card.classList.remove('selected', 'has-download', 'has-launch');
        card.classList.add('empty');
        delete card.dataset['currentModule'];
        delete card.dataset['currentModuleName'];
        const originalHtml = card.dataset['originalHtml'];
        if (originalHtml !== undefined && originalHtml !== '') {
            card.innerHTML = originalHtml;
        }
    }

    /** Stops the AI provider when all AI capability slots are empty. */
    private _stopAiProviderIfNoSlots(category: string): void {
        if (!category.startsWith('ai')) return;
        const hasAnyAiSlot =
            this._selectedApps.has('ai_text') || this._selectedApps.has('ai_image');
        if (!hasAnyAiSlot) {
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

        const textApp = this._selectedApps.get('ai_text');
        const imageApp = this._selectedApps.get('ai_image');
        if (textApp === undefined || imageApp === undefined) return;

        // Determine which is secondary (not currently shown on the card)
        const shownModule = card.dataset['currentModule'];
        const secondaryApp = shownModule === textApp.id ? imageApp : textApp;

        // Build badge using same pattern as _addSettingsBtn
        const badge = document.createElement('div');
        badge.className = 'module-action-badge bottom-right stack';

        badge.innerHTML = DOMPurify.sanitize(
            `<div class="badge-text">${secondaryApp.name ?? secondaryApp.id}</div>` +
                `<div class="badge-icon">+1</div>`,
            this._purifyConfig,
        );

        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            const openCapability = shownModule === textApp.id ? 'ai_image' : 'ai_text';
            this.openAppSelection(openCapability);
        });

        badge.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        card.appendChild(badge);
    }

    // --- Private Helper Methods ---

    // _getSortedApps removed (delegated to ModalManager)

    // _createAppCard removed (delegated to ModuleCardRenderer)

    private async _handleAppCardClick(e: MouseEvent, app: IApp, category: string): Promise<void> {
        if (await this._tryDeleteAction(e, app, category)) return;
        if (await this._tryDownloadAction(e, app, category)) return;
        this._performSelectionAction(category, app);
    }

    private async _tryDeleteAction(e: MouseEvent, app: IApp, category: string): Promise<boolean> {
        const target = e.target as HTMLElement;
        if (target.closest('.app-delete-badge') !== null) {
            e.stopPropagation();
            await this._handleDeleteModule(app, category);
            return true;
        }
        return false;
    }

    private async _tryDownloadAction(e: MouseEvent, app: IApp, category: string): Promise<boolean> {
        const isApi = this._platformService.isApiModule(app);

        // Any click on an uninstalled local app should trigger download, not selection
        if (!isApi && app.installed !== true) {
            if (app.repoUrl === undefined || app.repoUrl === '') {
                tracer.warn('[AppUI] Download URL is empty for module:', app.id);
                const win = getGlobalWin();
                this.showToast(
                    typeof win.t === 'function'
                        ? win.t(
                              'ui.launcher.web.download_url_empty',
                              'Download URL is not available',
                          )
                        : 'Download URL is not available',
                    'warning',
                );
                return true;
            }

            e.stopPropagation();

            // Find the .download-btn inside the card — use currentTarget (the .app-card)
            // which is always correct regardless of where inside the card was clicked.
            const card =
                (e.currentTarget as HTMLElement | null) ??
                (e.target as HTMLElement).closest('.app-card');
            const btnToAnimate = card?.querySelector<HTMLElement>('.download-btn') ?? null;

            // Guard: if already downloading, cancel instead of ignoring
            if (btnToAnimate?.classList.contains('downloading') === true) {
                tracer.info(`[AppUI] Cancelling download for: ${app.id}`);
                void (async () => {
                    try {
                        await this._platformService.cancelDownload(app.id);
                        await this._platformService.delete(app);
                        btnToAnimate.classList.remove('downloading', 'indeterminate');
                        btnToAnimate.style.removeProperty('--download-progress');
                        btnToAnimate.style.pointerEvents = 'auto';
                        const pct = btnToAnimate.querySelector<HTMLElement>('.download-pct');
                        if (pct) pct.style.display = 'none';
                        const label = btnToAnimate.querySelector<HTMLElement>('.download-label');
                        const win = getGlobalWin();
                        const defaultText =
                            typeof win.t === 'function'
                                ? win.t('ui.launcher.module.download', 'Download')
                                : 'Download';
                        if (label) {
                            label.style.display = '';
                            label.textContent = defaultText;
                        }
                    } catch (err) {
                        tracer.error(`[AppUI] Cancel failed for ${app.id}:`, err);
                    }
                })();
                return true;
            }

            await this._handleDownloadModule(app, category, btnToAnimate);
            return true;
        }
        return false;
    }

    private _performSelectionAction(category: string, app: IApp): void {
        const win = getGlobalWin();
        const alreadySelected = this._selectedApps.get(category)?.id === app.id;

        if (alreadySelected) {
            // Deselect: clear dashboard card and remove from tracked selection
            this.clearModuleCard(category);
            this._modalManager.updateSelection(null);
        } else {
            // Update dashboard card directly with compound key (skipping win.selectApp which
            // always passes rawCategory='ai' and would overwrite the compound slot)
            this.updateModuleCard(category, app);
            this._modalManager.updateSelection(app.id);

            // Persist to uiState with compound key ('ai_text' / 'ai_image') for session restore
            const uiState = win.uiState;
            if (typeof uiState.setSelectedModule === 'function') {
                uiState.setSelectedModule(category, {
                    id: app.id,
                    name: app.name ?? '',
                    nameKey: app.nameKey ?? '',
                    icon: app.icon ?? '',
                    type: app.type ?? 'local',
                    descKey: app.descKey ?? '',
                    desc: app.desc ?? '',
                });
            }

            // Auto-launch the selected module
            if (typeof win.launchApp === 'function') {
                void (win.launchApp as (id: string) => Promise<void>)(app.id);
            }
        }
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
        tracer.info('[AppUI] Remove module clicked:', app.id);
        const win = getGlobalWin();
        try {
            await this._platformService.delete(app);
            app.installed = false;

            // Clear from dashboard if it was the currently selected app
            if (this._selectedApps.get(category)?.id === app.id) {
                this.clearModuleCard(category);
            }

            // Refresh logic remains in UI for now (Phase 1 can refactor this)
            const rawCategory = category.startsWith('ai') ? 'ai' : category;
            const allApps = (win.getCatalogCategory as (cat: string) => IApp[])(rawCategory);
            this.openAppSelection(category, allApps);
        } catch (err: unknown) {
            tracer.error('[AppUI] Delete error:', err);
            const error = err as Error;
            const msg = error.message.startsWith('ui.')
                ? error.message
                : 'ui.launcher.web.delete_model_error';
            const fallback = msg === 'ui.launcher.web.delete_model_error' ? 'Delete error' : msg;

            const g = getGlobalWin();
            this.showToast(typeof g.t === 'function' ? g.t(msg, fallback) : fallback, 'error');
        }
    }

    private async _handleDownloadModule(
        app: IApp,
        _category: string,
        btn: HTMLElement | null,
    ): Promise<void> {
        tracer.info('[AppUI] Download module clicked:', app.id);

        // ModalManager handles all visual progress updates via the global
        // 'download-progress-update' event listener. We just await the
        // underlying download promise to update the app state.
        if (btn !== null) {
            btn.classList.add('downloading', 'indeterminate');
            btn.style.setProperty('--download-progress', '0%');

            const pct = btn.querySelector<HTMLElement>('.download-pct');
            if (pct) {
                pct.style.display = '';
                pct.textContent = '0%';
            }

            const label = btn.querySelector<HTMLElement>('.download-label');
            if (label) {
                label.textContent = '';
            }
        }

        try {
            await this._platformService.download(app);
            this._onModalDownloadSuccess(btn, app);
        } catch (err: unknown) {
            this._onModalDownloadError(btn, err);
        }
    }

    private _onModalDownloadSuccess(btn: HTMLElement | null, app: IApp): void {
        app.installed = true;
        if (btn !== null) {
            btn.classList.remove('downloading', 'indeterminate');
            btn.style.removeProperty('--download-progress');
            btn.style.pointerEvents = 'auto';
        }

        const card =
            btn?.closest<HTMLElement>('.model-card-premium') ??
            btn?.closest<HTMLElement>('.app-card');
        if (card instanceof HTMLElement) {
            this._markCardAsInstalled(card, app);
        }

        this._modalManager.refreshCurrentSelection();
    }

    private _onModalDownloadError(btn: HTMLElement | null, err: unknown): void {
        tracer.error('[AppUI] Download error:', err);
        if (btn !== null) {
            btn.classList.remove('downloading', 'indeterminate');
            btn.style.removeProperty('--download-progress');
            btn.style.pointerEvents = 'auto';
        }
        const error = err as Error;
        const msg = error.message.startsWith('ui.')
            ? error.message
            : 'ui.launcher.web.download_error';
        const fallback = msg === 'ui.launcher.web.download_error' ? 'Download failed' : msg;
        const win = getGlobalWin();
        this.showToast(typeof win.t === 'function' ? win.t(msg, fallback) : fallback, 'error');
    }

    private _stopPreviousModule(card: HTMLElement, app: IApp): void {
        const previousModuleId = card.dataset['currentModule'];
        if (
            previousModuleId === undefined ||
            previousModuleId === '' ||
            previousModuleId === app.id
        )
            return;

        const actionBtn = card.querySelector('.model-card-action');
        if (!(actionBtn instanceof HTMLElement)) return;
        if (actionBtn.dataset['running'] !== 'true') return;

        // Create a temporary app object for previous module (minimal needed for stop)
        // We might not have the full object, but _isApiModule uses type/id.
        // Let's assume previous module follows similar ID patterns if we don't have full object.
        // Actually, logic was: checks if ID in list OR type=api.
        // We have dataset['currentModuleName'] but not type.
        // However, if we just call stop, we need an IApp.
        // Let's rely on cached module list or simply infer.
        // The Service handles inference? No, service needs IApp to check props.
        // Existing code constructed `isApi` bool locally.

        // Let's just pass `app` (the current one) ? No, we need to stop the PREVIOUS one.
        // But we don't have the previous IApp object here easily.
        // The DOM has `dataset['currentModule']`.

        // HACK: Reconstruct a partial IApp to pass to `stop`.
        // This is a limitation of the current UI storage.
        // Ideally `AppUI` should track `_currentActiveApp: IApp`.

        const prevId = previousModuleId;
        const partialApp: IApp = {
            id: prevId,
            name: card.dataset['currentModuleName'] ?? prevId,
        } as IApp;

        // We need to know if it was API to know if we should call AIBridge.
        // StartPreviousModule logic:
        // const isApi = (app.type?.toLowerCase() ?? '') === 'api' || ['gpt',...].includes(app.id);
        // We can do the checks on ID.
        // PlatformService `isApiModule` checks ID list too.

        void this._platformService.stop(partialApp).then(() => {
            const prevName = card.dataset['currentModuleName'] ?? prevId;
            // UI Toast (service handles API stop silent, local logs info)
            // If local, we might want to show toast.
            // For now, let's keep the toast here as UI feedback.
            if (!this._platformService.isApiModule(partialApp)) {
                const win = getGlobalWin();
                if (typeof win.showToast === 'function') {
                    win.showToast(
                        typeof win.t === 'function'
                            ? win.t('ui.launcher.module.stopped', `${prevName} stopped`)
                            : `${prevName} stopped`,
                        'info',
                    );
                }
            }
        });

        tracer.info('[AppUI] Stopped previous module:', previousModuleId);
    }

    // _updateCardAttributes removed (delegated to ModuleCardRenderer)

    // _markCardAsInstalled delegated
    private _markCardAsInstalled(card: HTMLElement, app: IApp): void {
        this._cardRenderer.markCardAsInstalled(card, app, (c, a) => this._configureActionBtn(c, a));
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
        const settingsBtn = document.createElement('div');
        settingsBtn.className = 'module-action-badge left settings';
        const win = getGlobalWin();
        settingsBtn.innerHTML = DOMPurify.sanitize(
            `
            <div class="badge-icon"><span style="font-size: 1.1rem;">⚙️</span></div>
            <div class="badge-text" data-i18n="ui.launcher.module.settings_short">${typeof win.t === 'function' ? win.t('ui.launcher.module.settings_short', 'Settings') : 'Settings'}</div>
        `,
            this._purifyConfig,
        );
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            tracer.info('[AppUI] Settings button clicked (event) for:', app.id);
            const win = getGlobalWin();
            if (typeof win.openModuleSettings === 'function') win.openModuleSettings(app);
            else tracer.error('[AppUI] globalThis.openModuleSettings is undefined'); // Suppress loop below if needed
        });
        settingsBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            tracer.debug('[AppUI] Settings button mousedown for:', app.id);
        });
        card.appendChild(settingsBtn);
    }

    private _addCloseBtn(card: HTMLElement, category: string): void {
        const closeBtn = document.createElement('div');
        closeBtn.className = 'module-action-badge right close';
        const win = getGlobalWin();
        closeBtn.innerHTML = DOMPurify.sanitize(
            `
            <div class="badge-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display: block;">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </div>
            <div class="badge-text" data-i18n="ui.launcher.module.remove_short">${typeof win.t === 'function' ? win.t('ui.launcher.module.remove_short', 'Close') : 'Close'}</div>
        `,
            this._purifyConfig,
        );
        closeBtn.onclick = (e): void => {
            e.stopImmediatePropagation();
            // clearModuleCard: if the other AI slot is active, shows it on the card
            // instead of blanking the card entirely
            this.clearModuleCard(category);
            // Also remove from uiState persistence
            const globalWin = getGlobalWin();
            globalWin.uiState.removeSelectedModule(category);
        };
        card.appendChild(closeBtn);
    }

    // --- Prompt Tab Switching (for chat/settings) ---
    public showPromptTab(tab: string, btn?: HTMLElement): void {
        document.querySelectorAll('.prompt-tab-content').forEach((t) => {
            (t as HTMLElement).style.display = 'none';
        });

        const targetTab = document.getElementById(`prompt-tab-${tab}`);
        if (targetTab !== null) targetTab.style.display = 'block';

        if (btn?.parentElement) {
            btn.parentElement.querySelectorAll('button').forEach((b) => {
                (b as HTMLElement).style.background = 'var(--surface)';
                (b as HTMLElement).style.color = 'var(--text-secondary)';
            });
            btn.style.background = 'var(--primary)';
            btn.style.color = 'white';
        }
    }
    // --- New Private Helpers ---
    // --- Private Helper Methods ---

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
