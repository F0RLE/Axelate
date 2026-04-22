import type { IApp } from '../../types/coreTypes';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { ModuleCardRenderer } from './ModuleCardRenderer';
import { ModalFilterTransitionController } from './ModalFilterTransitionController';
import {
    cancelModalDownload,
    createModalDownloadProgressHandler,
    populateModalAppList,
    transitionSelectionButton,
    updateModalSidebarWidth,
} from './ModalManagerSupport';
import { ModalSelectionPolicy } from './ModalSelectionPolicy';
import { ModalFocusTrapHelper } from './ModalFocusTrapHelper';

/**
 * @class ModalManager
 * @description Handles the App Selection modal and other potential overlays.
 */
export class ModalManager {
    private readonly _cardRenderer: ModuleCardRenderer;
    private readonly _selectionPolicy = new ModalSelectionPolicy();
    private _currentCategory: string | null = null;
    private _currentApps: IApp[] = [];
    private _currentFilter: 'text' | 'image' = 'text';
    private _currentSelectedAppId: string | null = null;
    private _overlayClickModal: HTMLDialogElement | null = null;
    private readonly _focusTrap = new ModalFocusTrapHelper(() => {
        this.closeAppSelection();
    });
    private readonly _filterTransitionController = new ModalFilterTransitionController({
        getCurrentFilter: () => this._currentFilter,
        setCurrentFilter: (filter) => {
            this._currentFilter = filter;
        },
        getCurrentCategory: () => this._currentCategory,
        getCurrentApps: () => this._currentApps,
        isModalOpen: () => this.isAppSelectionOpen(),
        onFilterChange: (filter) => this._onFilterChange(filter),
        updateSelectedAppId: (appId) => {
            this._currentSelectedAppId = appId;
        },
        populateAppList: (listElement, selectedAppId) => {
            if (this._currentCategory === null) {
                return;
            }

            this._populateAppList(
                listElement,
                this._currentApps,
                this._currentCategory,
                selectedAppId,
            );
        },
        translate: (key, fallback) => this._translate(key, fallback),
        selectionPolicy: this._selectionPolicy,
    });
    // Keeps reference for potential future cleanup
    private readonly _progressHandler: (e: Event) => void;

    // Callback for app interactions (Download, Delete, Select)
    private readonly _onAppInteraction: (e: MouseEvent, app: IApp, category: string) => void;
    // Called when user switches filter tab — returns the selected app ID for that capability
    private readonly _onFilterChange: (capability: 'text' | 'image') => string | null;
    private readonly _onDownloadRequest: (app: IApp) => Promise<void>;
    private readonly _onCancelDownloadRequest: (app: IApp) => Promise<void>;
    private readonly _translate: (key: string, fallback: string) => string;
    private readonly _tracer: LoggerService;

    constructor(
        cardRenderer: ModuleCardRenderer,
        onAppInteraction: (e: MouseEvent, app: IApp, category: string) => void,
        onFilterChange: (capability: 'text' | 'image') => string | null,
        onDownloadRequest: (app: IApp) => Promise<void>,
        onCancelDownloadRequest: (app: IApp) => Promise<void>,
        translate: (key: string, fallback: string) => string,
        tracer: LoggerService,
        private readonly _navigation: NavigationService,
    ) {
        this._cardRenderer = cardRenderer;
        this._onAppInteraction = onAppInteraction;
        this._onFilterChange = onFilterChange;
        this._onDownloadRequest = onDownloadRequest;
        this._onCancelDownloadRequest = onCancelDownloadRequest;
        this._translate = translate;
        this._tracer = tracer;

        this._progressHandler = createModalDownloadProgressHandler();

        globalThis.addEventListener('download-progress-update', this._progressHandler);
    }

    public destroy(): void {
        this._filterTransitionController.destroy();
        this._detachOverlayCloseHandler();
        globalThis.removeEventListener('download-progress-update', this._progressHandler);
        this.closeAppSelection();
    }

    // --- App Selection Modal ---

    public openAppSelection(category: string, apps: IApp[], selectedAppId?: string): void {
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement | null;
        const listEl = document.getElementById('app-modal-list');

        this._tracer.info(
            `[ModalManager] Opening selection modal for ${category} with ${String(apps.length)} items.`,
        );

        if (modal === null || listEl === null) return;

        this._filterTransitionController.cancelPending();
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
            this._focusTrap.attachOverlayOnly(modal);
            return;
        }

        // Prevent Chromium from painting an intermediate frame with stale/default dialog visuals.
        modal.style.visibility = 'hidden';
        modal.classList.remove('hidden');
        if (typeof modal.show === 'function') {
            modal.show();
        } else if (typeof modal.showModal === 'function') {
            modal.showModal();
        } else {
            modal.setAttribute('open', '');
        }
        this._focusTrap.focusFirstElement(modal);
        requestAnimationFrame(() => {
            modal.style.removeProperty('visibility');
            setTimeout(() => {
                if (this._overlayClickModal === modal && this.isAppSelectionOpen()) {
                    this._focusTrap.focusFirstElement(modal);
                }
            }, 0);
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
        this._focusTrap.attach(modal);
    }

    public closeAppSelection(): void {
        this._filterTransitionController.cancelPending();
        this._navigation.removeBackAction('app-selection-modal');
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement | null;
        if (modal) {
            modal.style.removeProperty('--app-modal-dynamic-height');
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

        const { key, defaultText } = this._selectionPolicy.getModalTitleInfo(category);
        titleEl.textContent = this._translate(key, defaultText);
    }

    private _updateSidebar(rawCategory: string, compoundCategory: string, apps: IApp[]): void {
        const titleEl = document.getElementById('app-modal-title');
        const tabRow = document.getElementById('app-modal-tab-row');

        if (this._selectionPolicy.shouldShowFilterTabs(rawCategory)) {
            // Show tab row, hide plain title
            if (titleEl) titleEl.classList.add('hidden');
            if (tabRow) tabRow.classList.remove('hidden');

            this._bindFilterEvents(compoundCategory);
            this._applyImageFilterAvailability(apps, this._translate);
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
        _t: (key: string, defaultText: string) => string,
    ): void {
        this._currentFilter = this._filterTransitionController.syncAvailability(apps);
    }

    private _bindFilterEvents(category: string): void {
        this._filterTransitionController.bind(category);
    }

    private _detachOverlayCloseHandler(): void {
        this._focusTrap.detach();
        this._overlayClickModal = null;
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
        populateModalAppList({
            listElement: listEl,
            apps,
            category,
            selectedAppId,
            currentFilter: this._currentFilter,
            selectionPolicy: this._selectionPolicy,
            cardRenderer: this._cardRenderer,
            onAppInteraction: this._onAppInteraction,
            onDownload: (app) => this._handleDownload(app),
            translate: this._translate,
        });
    }

    /**
     * Triggers a module download or cancellation via injected AppUI callbacks.
     */
    private _handleDownload(app: IApp): void {
        if (app.repoUrl === undefined || app.repoUrl === '') {
            this._tracer.warn(`[ModalManager] No repoUrl for module: ${app.id}`);
            return;
        }

        const list = document.getElementById('app-modal-list');
        const card = list?.querySelector<HTMLElement>(`.app-card[data-app-id="${app.id}"]`);
        const btn = card?.querySelector<HTMLButtonElement>('.download-btn');

        // Check if currently downloading to cancel instead
        if (btn?.classList.contains('downloading') === true) {
            this._tracer.info(`[ModalManager] Cancelling download for: ${app.id}`);
            void (async () => {
                try {
                    await cancelModalDownload({
                        app,
                        card,
                        button: btn,
                        onCancelDownloadRequest: this._onCancelDownloadRequest,
                        translate: this._translate,
                    });
                } catch (err) {
                    this._tracer.error(`[ModalManager] Cancel failed for ${app.id}:`, err);
                }
            })();
            return;
        }

        this._tracer.info(`[ModalManager] Starting download: ${app.id}`);
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
        transitionSelectionButton({
            card,
            isSelected,
            selectionPolicy: this._selectionPolicy,
            translate: this._translate,
        });
    }

    private _updateDynamicSidebarWidth(): void {
        const sidebar = document.getElementById('app-modal-sidebar');
        if (sidebar === null) return;

        updateModalSidebarWidth(sidebar);
    }
}
