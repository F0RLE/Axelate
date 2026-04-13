import type { IApp } from '../../types/coreTypes';
import { getGlobalWin } from '../../utils/globalAccessor';
import { tracer } from '@/infrastructure/logging/LoggerService';
import { type NavigationService } from '@/infrastructure/navigation/NavigationService';
import { ModuleCardRenderer } from './ModuleCardRenderer';

/**
 * @class ModalManager
 * @description Handles the App Selection modal and other potential overlays.
 */
export class ModalManager {
    private readonly _cardRenderer: ModuleCardRenderer;
    private _currentCategory: string | null = null;
    private _currentApps: IApp[] = [];
    private _currentFilter: 'text' | 'image' = 'text';
    private _currentSelectedAppId: string | null = null;
    private _overlayClickModal: HTMLDialogElement | null = null;
    private _filterPopulateTimer: ReturnType<typeof setTimeout> | null = null;
    private _filterStyleResetTimer: ReturnType<typeof setTimeout> | null = null;
    private _filterTransitionVersion = 0;
    // Keeps reference for potential future cleanup
    private readonly _progressHandler: (e: Event) => void;
    private readonly _boundOverlayClick = (e: MouseEvent) => {
        if (e.target === this._overlayClickModal) {
            this.closeAppSelection();
        }
    };

    // Callback for app interactions (Download, Delete, Select)
    private readonly _onAppInteraction: (e: MouseEvent, app: IApp, category: string) => void;
    // Called when user switches filter tab — returns the selected app ID for that capability
    private readonly _onFilterChange: (capability: 'text' | 'image') => string | null;
    private readonly _onDownloadRequest: (app: IApp) => Promise<void>;
    private readonly _onCancelDownloadRequest: (app: IApp) => Promise<void>;

    constructor(
        cardRenderer: ModuleCardRenderer,
        onAppInteraction: (e: MouseEvent, app: IApp, category: string) => void,
        onFilterChange: (capability: 'text' | 'image') => string | null,
        onDownloadRequest: (app: IApp) => Promise<void>,
        onCancelDownloadRequest: (app: IApp) => Promise<void>,
        private readonly _navigation: NavigationService,
    ) {
        this._cardRenderer = cardRenderer;
        this._onAppInteraction = onAppInteraction;
        this._onFilterChange = onFilterChange;
        this._onDownloadRequest = onDownloadRequest;
        this._onCancelDownloadRequest = onCancelDownloadRequest;

        // Per-module throttle state: maps moduleId → last render timestamp
        const _throttleMap = new Map<string, number>();

        // Subscribe to download progress updates emitted by ModuleService
        // and forward them to the card's download button in the modal list.
        this._progressHandler = (e: Event) => {
            const payload = (e as CustomEvent).detail as {
                module_id: string;
                status: string;
                progress: number;
            };
            if (!payload.module_id) return;

            const now = Date.now();
            const isTerminal =
                payload.status === 'complete' ||
                payload.status === 'error' ||
                payload.status === 'cancelled';

            // Always apply terminal states immediately; throttle transient progress ticks
            const lastRender = _throttleMap.get(payload.module_id) ?? 0;
            const withinThrottle = isTerminal === false && now - lastRender < 150;
            if (withinThrottle) return;
            _throttleMap.set(payload.module_id, now);

            const list = document.getElementById('app-modal-list');
            if (!list) return;

            const card = list.querySelector<HTMLElement>(
                `.app-card[data-app-id="${payload.module_id}"]`,
            );
            if (!card) return;

            if (isTerminal) {
                _throttleMap.delete(payload.module_id);
                ModuleCardRenderer.clearDownloadProgress(card);
                if (payload.status === 'complete') {
                    card.classList.add('is-installed');
                }
            } else {
                const pct = payload.progress < 0 ? -1 : Math.round(payload.progress * 100);
                ModuleCardRenderer.setDownloadProgress(card, pct, payload.status);
            }
        };

        globalThis.addEventListener('download-progress-update', this._progressHandler);
    }

    public destroy(): void {
        this._cancelPendingFilterTransition();
        this._detachOverlayCloseHandler();
        globalThis.removeEventListener('download-progress-update', this._progressHandler);
        this.closeAppSelection();
    }

    // --- App Selection Modal ---

    public openAppSelection(category: string, apps: IApp[], selectedAppId?: string): void {
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement | null;
        const listEl = document.getElementById('app-modal-list');

        tracer.info(
            `[ModalManager] Opening selection modal for ${category} with ${String(apps.length)} items.`,
        );

        if (modal === null || listEl === null) return;

        this._cancelPendingFilterTransition();
        this._detachOverlayCloseHandler();

        this._currentCategory = category;
        this._currentApps = apps;
        this._currentSelectedAppId = selectedAppId ?? null;

        // Derive filter from compound category — do NOT blindly reset to 'text'
        // so that reopening after removing an image-slot app stays on the image tab.
        if (category === 'ai_image') {
            this._currentFilter = 'image';
        } else if (category === 'ai_text' || category === 'ai') {
            this._currentFilter = 'text';
        }
        // Otherwise keep whatever was previously selected (e.g. when refreshing)

        this._renderSelectionState(category, apps, this._currentSelectedAppId);

        if (modal.open && !modal.classList.contains('hidden')) {
            this._overlayClickModal = modal;
            modal.addEventListener('click', this._boundOverlayClick);
            return;
        }

        // Prevent Chromium from painting an intermediate frame with stale/default dialog visuals.
        modal.style.visibility = 'hidden';
        modal.classList.remove('hidden');
        modal.showModal();
        requestAnimationFrame(() => {
            modal.style.removeProperty('visibility');
        });

        // Add smooth hiding for main content
        const container = document.querySelector('.models-container');
        if (container !== null) container.classList.add('content-hidden');

        // Register back action for mouse/keyboard global navigation
        this._navigation.pushBackAction(
            'app-selection-modal',
            () => {
                this.closeAppSelection();
            },
            () => {
                this.openAppSelection(
                    this._currentCategory ?? category,
                    this._currentApps.length > 0 ? this._currentApps : apps,
                    this._currentSelectedAppId ?? undefined,
                );
            },
        );

        this._overlayClickModal = modal;
        modal.addEventListener('click', this._boundOverlayClick);
    }

    public closeAppSelection(): void {
        this._cancelPendingFilterTransition();
        this._navigation.removeBackAction('app-selection-modal');
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement | null;
        if (modal) {
            this._detachOverlayCloseHandler();
            if (modal.open) {
                modal.close();
            }
            modal.classList.add('hidden');
            modal.style.removeProperty('visibility');
        }

        // Restore main content visibility
        const container = document.querySelector('.models-container');
        if (container !== null) container.classList.remove('content-hidden');
    }

    public isAppSelectionOpen(): boolean {
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement | null;
        return modal !== null && modal.open && !modal.classList.contains('hidden');
    }

    public refreshCurrentSelection(apps?: IApp[], selectedAppId?: string | null): void {
        if (apps !== undefined) {
            this._currentApps = apps;
        }
        if (selectedAppId !== undefined) {
            this._currentSelectedAppId = selectedAppId;
        }

        if (this._currentCategory === null || this._currentApps.length === 0) {
            return;
        }

        if (this.isAppSelectionOpen()) {
            this._renderSelectionState(
                this._currentCategory,
                this._currentApps,
                this._currentSelectedAppId,
            );
        }
    }

    public isViewingCategory(category: string): boolean {
        return this.isAppSelectionOpen() && this._currentCategory === category;
    }

    // --- Helpers ---

    private _updateAppModalTitle(category: string): void {
        const titleEl = document.getElementById('app-modal-title');
        if (titleEl === null) return;

        const { key, defaultText } = this._getModalTitleInfo(category);
        const win = getGlobalWin();
        titleEl.textContent = typeof win.t === 'function' ? win.t(key, defaultText) : defaultText;
    }

    private _getModalTitleInfo(category: string): { key: string; defaultText: string } {
        if (category === 'ai' || category === 'ai_text') {
            return {
                key: 'ui.launcher.modules.modal.ai_title',
                defaultText: 'Select AI Module',
            };
        }
        if (category === 'ai_image') {
            return {
                key: 'ui.launcher.modules.modal.ai_image_title',
                defaultText: 'Select Image AI',
            };
        }
        return {
            key: 'ui.launcher.modules.modal.services_title',
            defaultText: 'Select Service',
        };
    }

    private _updateSidebar(rawCategory: string, compoundCategory: string, apps: IApp[]): void {
        const titleEl = document.getElementById('app-modal-title');
        const tabRow = document.getElementById('app-modal-tab-row');

        const win = getGlobalWin();
        const t = (key: string, defaultText: string) =>
            typeof win.t === 'function' ? win.t(key, defaultText) : defaultText;

        if (rawCategory === 'ai') {
            // Show tab row, hide plain title
            if (titleEl) titleEl.classList.add('hidden');
            if (tabRow) tabRow.classList.remove('hidden');

            this._bindFilterEvents(compoundCategory);
            this._applyImageFilterAvailability(apps, t);
        } else {
            // Show plain title, hide tab row
            if (titleEl) titleEl.classList.remove('hidden');
            if (tabRow) tabRow.classList.add('hidden');
        }
    }

    /**
     * Disables the Image tab when no apps have 'image' capability.
     */
    private _applyImageFilterAvailability(
        apps: IApp[],
        t: (key: string, defaultText: string) => string,
    ): void {
        const hasImageApps = apps.some((app) => app.capability === 'image');
        if (!hasImageApps && this._currentFilter === 'image') {
            this._currentFilter = 'text';
        }

        const textBtn = document.getElementById('filter-text-btn') as HTMLButtonElement | null;
        const imgBtn = document.getElementById('filter-image-btn') as HTMLButtonElement | null;
        if (imgBtn === null) return;

        imgBtn.disabled = !hasImageApps;
        imgBtn.style.opacity = hasImageApps ? '' : '0.4';
        imgBtn.style.cursor = hasImageApps ? '' : 'not-allowed';
        imgBtn.title = hasImageApps ? '' : t('ui.launcher.web.coming_soon', 'Coming soon');
        if (textBtn) textBtn.classList.toggle('active', this._currentFilter === 'text');
        imgBtn.classList.toggle('active', this._currentFilter === 'image');
    }

    private _bindFilterEvents(category: string): void {
        const textBtn = document.getElementById('filter-text-btn') as HTMLButtonElement | null;
        const imageBtn = document.getElementById('filter-image-btn') as HTMLButtonElement | null;

        const updateTabUI = () => {
            if (textBtn) textBtn.classList.toggle('active', this._currentFilter === 'text');
            if (imageBtn) imageBtn.classList.toggle('active', this._currentFilter === 'image');
        };

        const applyFilter = (filterType: 'text' | 'image') => {
            if (this._currentFilter === filterType) return;
            this._currentFilter = filterType;
            updateTabUI();

            this._currentSelectedAppId = this._onFilterChange(filterType);

            const listEl = document.getElementById('app-modal-list');
            if (listEl) {
                this._cancelPendingFilterTransition();
                const transitionVersion = ++this._filterTransitionVersion;
                listEl.style.willChange = 'opacity, transform';
                listEl.style.transition =
                    'opacity 0.14s cubic-bezier(0.22, 1, 0.36, 1), transform 0.14s cubic-bezier(0.22, 1, 0.36, 1)';
                listEl.style.opacity = '0.72';
                listEl.style.transform = 'translateY(6px) scale(0.992)';

                this._filterPopulateTimer = setTimeout(() => {
                    this._filterPopulateTimer = null;
                    if (
                        transitionVersion !== this._filterTransitionVersion ||
                        !this.isAppSelectionOpen() ||
                        this._currentCategory !== category ||
                        document.getElementById('app-modal-list') !== listEl
                    ) {
                        return;
                    }
                    this._populateAppList(
                        listEl,
                        this._currentApps,
                        category,
                        this._currentSelectedAppId,
                    );
                    listEl.getBoundingClientRect();
                    listEl.style.opacity = '1';
                    listEl.style.transform = 'translateY(0) scale(1)';
                    this._filterStyleResetTimer = setTimeout(() => {
                        this._filterStyleResetTimer = null;
                        if (
                            transitionVersion !== this._filterTransitionVersion ||
                            document.getElementById('app-modal-list') !== listEl
                        ) {
                            return;
                        }
                        listEl.style.willChange = 'auto';
                    }, 180);
                }, 110);
            }
        };

        if (textBtn) textBtn.onclick = () => applyFilter('text');
        if (imageBtn) imageBtn.onclick = () => applyFilter('image');

        // Ensure initial state reflects _currentFilter
        updateTabUI();
    }

    private _detachOverlayCloseHandler(): void {
        if (this._overlayClickModal !== null) {
            this._overlayClickModal.removeEventListener('click', this._boundOverlayClick);
            this._overlayClickModal = null;
        }
    }

    private _cancelPendingFilterTransition(): void {
        this._filterTransitionVersion += 1;
        if (this._filterPopulateTimer !== null) {
            clearTimeout(this._filterPopulateTimer);
            this._filterPopulateTimer = null;
        }

        if (this._filterStyleResetTimer !== null) {
            clearTimeout(this._filterStyleResetTimer);
            this._filterStyleResetTimer = null;
        }

        const listEl = document.getElementById('app-modal-list');
        if (!(listEl instanceof HTMLElement)) return;

        listEl.style.removeProperty('will-change');
        listEl.style.removeProperty('transition');
        listEl.style.removeProperty('opacity');
        listEl.style.removeProperty('transform');
    }

    private _renderSelectionState(
        category: string,
        apps: IApp[],
        selectedAppId: string | null,
    ): void {
        const listEl = document.getElementById('app-modal-list');
        if (!(listEl instanceof HTMLElement)) return;

        this._updateAppModalTitle(category);
        this._updateSidebar(category.startsWith('ai') ? 'ai' : category, category, apps);
        this._populateAppList(listEl, apps, category, selectedAppId);
        this._updateDynamicSidebarWidth();
    }

    private _populateAppList(
        listEl: HTMLElement,
        apps: IApp[],
        category: string,
        selectedAppId: string | null,
    ): void {
        listEl.innerHTML = '';

        let filteredApps = apps;
        const isAi = category === 'ai' || category.startsWith('ai_');
        if (isAi) {
            filteredApps = apps.filter((app) => {
                const cap = app.capability ?? 'text';
                return cap === this._currentFilter;
            });
        }

        const sorted = this._getSortedApps(filteredApps);

        if (sorted.length === 0) {
            this._renderEmptyState(listEl);
            return;
        }

        const interactionCategory = isAi ? `ai_${this._currentFilter}` : category;
        this._renderAppCards(listEl, sorted, interactionCategory, selectedAppId);
    }

    private _renderEmptyState(listEl: HTMLElement): void {
        const template = document.getElementById(
            'tpl-empty-state-module',
        ) as HTMLTemplateElement | null;
        if (template) {
            const clone = template.content.cloneNode(true) as DocumentFragment;
            const span = clone.querySelector('span');
            if (span) {
                span.dataset['i18n'] = 'ui.launcher.modules.modal.no_apps_filter';
                const win = getGlobalWin();
                span.textContent =
                    typeof win.t === 'function'
                        ? win.t(
                              'ui.launcher.modules.modal.no_apps_filter',
                              'No applications found for this type',
                          )
                        : 'No applications found for this type';
            }
            listEl.appendChild(clone);
        }
    }

    private _renderAppCards(
        listEl: HTMLElement,
        apps: IApp[],
        interactionCategory: string,
        selectedAppId: string | null,
    ): void {
        apps.forEach((app) => {
            const isSelected = selectedAppId !== null && app.id === selectedAppId;
            const card = this._cardRenderer.createCard(
                app,
                interactionCategory,
                isSelected,
                (e, a) => this._onAppInteraction(e, a, interactionCategory),
                (a) => this._handleDownload(a),
            );
            listEl.appendChild(card);
        });
    }

    /**
     * Triggers a module download or cancellation via injected AppUI callbacks.
     */
    private _handleDownload(app: IApp): void {
        if (app.repoUrl === undefined || app.repoUrl === '') {
            tracer.warn(`[ModalManager] No repoUrl for module: ${app.id}`);
            return;
        }

        const list = document.getElementById('app-modal-list');
        const card = list?.querySelector<HTMLElement>(`.app-card[data-app-id="${app.id}"]`);
        const btn = card?.querySelector<HTMLButtonElement>('.download-btn');

        // Check if currently downloading to cancel instead
        if (btn?.classList.contains('downloading') === true) {
            tracer.info(`[ModalManager] Cancelling download for: ${app.id}`);
            void (async () => {
                try {
                    await this._onCancelDownloadRequest(app);
                    if (card !== null && card !== undefined)
                        ModuleCardRenderer.clearDownloadProgress(card);
                    // Reset UI label
                    const pct = btn.querySelector<HTMLElement>('.download-pct');
                    if (pct) pct.style.display = 'none';
                    const label = btn.querySelector<HTMLElement>('.download-label');
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
                    tracer.error(`[ModalManager] Cancel failed for ${app.id}:`, err);
                }
            })();
            return;
        }

        tracer.info(`[ModalManager] Starting download: ${app.id}`);
        void this._onDownloadRequest(app);
    }

    /**
     * Updates visual selection state of cards in-place without full re-render.
     * Smoothly transitions the Select/Remove button on affected cards.
     */
    public updateSelection(appId: string | null): void {
        const previousId = this._currentSelectedAppId;
        this._currentSelectedAppId = appId;

        const listEl = document.getElementById('app-modal-list');
        if (listEl === null) return;

        const cards = listEl.querySelectorAll<HTMLElement>('.app-card');
        cards.forEach((card) => {
            const cardAppId = card.dataset['appId'] ?? '';

            if (cardAppId === previousId && cardAppId !== appId) {
                // Was selected, now deselected
                card.classList.remove('selected');
                this._transitionButton(card, false);
            } else if (cardAppId === appId && cardAppId !== previousId) {
                // Becoming selected
                card.classList.add('selected');
                this._transitionButton(card, true);
            }
        });
    }

    private _transitionButton(card: HTMLElement, isSelected: boolean): void {
        const btn = card.querySelector<HTMLButtonElement>('.app-card-hover-actions button');
        if (btn === null) return;

        const appId = card.dataset['appId'] ?? '';
        const state = this._getButtonState(card, appId, isSelected);

        const win = getGlobalWin() as unknown as { t?: (k: string, d: string) => string };
        btn.className = state.className;
        btn.dataset['i18n'] = state.key;
        btn.textContent =
            typeof win.t === 'function' ? win.t(state.key, state.defaultLabel) : state.defaultLabel;
    }

    private _getButtonState(
        card: HTMLElement,
        appId: string,
        isSelected: boolean,
    ): {
        className: string;
        key: string;
        defaultLabel: string;
    } {
        if (!isSelected) {
            return {
                className: 'modal-btn modal-btn-primary',
                key: 'ui.launcher.modules.modal.btn_select',
                defaultLabel: 'Select',
            };
        }

        const win = getGlobalWin() as unknown as {
            aiBridge?: { getState: () => { activeProviderId?: string } };
        };
        const aiState = win.aiBridge?.getState();
        const isCurrentlyActiveAi = aiState?.activeProviderId === appId;

        const isStarting =
            card.classList.contains('engine-starting') ||
            card.classList.contains('engine-swapping');
        const isReady = card.classList.contains('engine-ready');
        const isEffectivelyRunning = isCurrentlyActiveAi || isReady;

        if (isStarting) {
            return {
                className: 'modal-btn modal-btn-secondary active-module-btn',
                key: 'ui.launcher.modules.modal.btn_booting',
                defaultLabel: 'Booting...',
            };
        }

        if (isEffectivelyRunning) {
            return {
                className: 'modal-btn modal-btn-secondary active-module-btn stop-btn',
                key: 'ui.launcher.modules.modal.btn_running',
                defaultLabel: 'Running',
            };
        }

        return {
            className: 'modal-btn modal-btn-secondary',
            key: 'ui.launcher.modules.modal.btn_remove',
            defaultLabel: 'Remove',
        };
    }

    private _getSortedApps(apps: IApp[]): IApp[] {
        const priority = ['axelate', 'gpt', 'gemini'];
        return [...apps].sort((a, b) => {
            const idA = a.id.toLowerCase();
            const idB = b.id.toLowerCase();
            const nameA = (a.name ?? a.id).toLowerCase();
            const nameB = (b.name ?? b.id).toLowerCase();
            const getP = (id: string): number => {
                const idx = priority.findIndex((p) => id.includes(p));
                return idx === -1 ? 999 : idx;
            };
            const priorityDiff = getP(idA) - getP(idB);
            if (priorityDiff !== 0) return priorityDiff;
            if ((a.installed === true) !== (b.installed === true)) {
                return a.installed === true ? -1 : 1;
            }
            return nameA.localeCompare(nameB);
        });
    }

    private _updateDynamicSidebarWidth(): void {
        const sidebar = document.getElementById('app-modal-sidebar');
        if (sidebar === null) return;

        const spans = Array.from(
            sidebar.querySelectorAll<HTMLElement>('.category-filter-btn span'),
        );
        let maxTextWidth = 0;

        spans.forEach((span) => {
            // scrollWidth gives the intrinsic unclipped width of the text
            if (span.scrollWidth > maxTextWidth) maxTextWidth = span.scrollWidth;
        });

        if (maxTextWidth > 0) {
            // 44 (icon box) + 12 (gap) + maxTextWidth + 16 (padding right)
            const expandedBtnWidth = 44 + 12 + maxTextWidth + 16;
            // Pad sidebar width slightly larger than the button
            const expandedSidebarWidth = Math.max(160, expandedBtnWidth + 24);

            sidebar.style.setProperty(
                '--sidebar-expanded-width',
                `${expandedSidebarWidth.toString()}px`,
            );
            sidebar.style.setProperty(
                '--filter-btn-expanded-width',
                `${expandedBtnWidth.toString()}px`,
            );
        }
    }
}
