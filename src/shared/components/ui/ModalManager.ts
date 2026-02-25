import type { IApp } from '../../types/coreTypes';
import { getGlobalWin } from '../../utils/globalAccessor';
import { logger } from '@/infrastructure/logging/LoggerService';
import { NavigationService } from '@/infrastructure/navigation/NavigationService';
import { type ModuleCardRenderer } from './ModuleCardRenderer';

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

    // Callback for app interactions (Download, Delete, Select)
    private readonly _onAppInteraction: (e: MouseEvent, app: IApp, category: string) => void;

    constructor(
        cardRenderer: ModuleCardRenderer,
        onAppInteraction: (e: MouseEvent, app: IApp, category: string) => void,
    ) {
        this._cardRenderer = cardRenderer;
        this._onAppInteraction = onAppInteraction;
    }

    // --- App Selection Modal ---

    public openAppSelection(category: string, apps: IApp[], selectedAppId?: string): void {
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement | null;
        const listEl = document.getElementById('app-modal-list');

        logger.info(
            `[ModalManager] Opening selection modal for ${category} with ${String(apps.length)} items.`,
        );

        if (modal === null || listEl === null) return;

        this._currentCategory = category;
        this._currentApps = apps;
        this._currentSelectedAppId = selectedAppId ?? null;

        // Reset filter when opening new category
        this._currentFilter = 'text';

        this._updateAppModalTitle(category);

        // Extract the raw catalog category and auto-set the filter
        const rawCategory = category.startsWith('ai') ? 'ai' : category;
        if (category === 'ai_text') {
            this._currentFilter = 'text';
        } else if (category === 'ai_image') {
            this._currentFilter = 'image';
        }

        this._updateSidebar(rawCategory, category);
        this._populateAppList(listEl, apps, category, this._currentSelectedAppId);

        modal.classList.remove('hidden');
        modal.showModal();

        // Calculate needed width for any language dynamically
        this._updateDynamicSidebarWidth();

        // Add smooth hiding for main content
        const container = document.querySelector('.models-container');
        if (container !== null) container.classList.add('content-hidden');

        // Register back action for mouse/keyboard global navigation
        NavigationService.getInstance().pushBackAction(
            'app-selection-modal',
            () => {
                this.closeAppSelection();
            },
            () => {
                this.openAppSelection(category, apps);
            },
        );

        // Close on overlay click
        const closeOnOverlay = (e: MouseEvent): void => {
            if (e.target === modal) {
                this.closeAppSelection();
                modal.removeEventListener('click', closeOnOverlay);
            }
        };
        modal.addEventListener('click', closeOnOverlay);
    }

    public closeAppSelection(): void {
        NavigationService.getInstance().removeBackAction('app-selection-modal');
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement | null;
        if (modal) {
            if (modal.open) {
                modal.close();
            }
            modal.classList.add('hidden');
        }

        // Restore main content visibility
        const container = document.querySelector('.models-container');
        if (container !== null) container.classList.remove('content-hidden');
    }

    public refreshCurrentSelection(): void {
        if (this._currentCategory !== null && this._currentApps.length > 0) {
            const modal = document.getElementById('app-selection-modal');
            if (modal !== null && !modal.classList.contains('hidden')) {
                this.openAppSelection(
                    this._currentCategory,
                    this._currentApps,
                    this._currentSelectedAppId ?? undefined,
                );
            }
        }
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

    private _updateSidebar(rawCategory: string, compoundCategory: string): void {
        const sidebar = document.getElementById('app-modal-sidebar');
        const iconContainer = document.getElementById('app-modal-sidebar-icon');
        const titleEl = document.getElementById('app-modal-sidebar-title');
        const descEl = document.getElementById('app-modal-sidebar-desc');
        const actionsEl = document.getElementById('app-modal-sidebar-actions');

        if (!sidebar || !iconContainer || !titleEl || !descEl || !actionsEl) return;

        const win = getGlobalWin();
        const t = (key: string, defaultText: string) =>
            typeof win.t === 'function' ? win.t(key, defaultText) : defaultText;

        const modalContent = document.querySelector('#app-selection-modal .app-modal');

        if (rawCategory === 'ai') {
            sidebar.classList.remove('hidden');
            if (modalContent) modalContent.classList.add('with-sidebar');

            iconContainer.innerHTML = '';
            iconContainer.style.display = 'none';

            titleEl.textContent = '';
            titleEl.style.display = 'none';

            // Hide description to keep things minimal
            descEl.textContent = '';
            descEl.style.display = 'none';

            this._injectFilterButtons(actionsEl, t);
            this._bindFilterEvents(compoundCategory);
            this._hideIrrelevantFilterTab(compoundCategory);
        } else {
            // Hide the sidebar completely for Services/Bots
            sidebar.classList.add('hidden');
            if (modalContent) modalContent.classList.remove('with-sidebar');
        }
    }

    private _hideIrrelevantFilterTab(compoundCategory: string): void {
        if (compoundCategory === 'ai_text') {
            const imgBtn = document.getElementById('filter-image-btn');
            if (imgBtn) imgBtn.style.display = 'none';
        } else if (compoundCategory === 'ai_image') {
            const txtBtn = document.getElementById('filter-text-btn');
            if (txtBtn) txtBtn.style.display = 'none';
        }
    }

    private _injectFilterButtons(
        actionsEl: HTMLElement,
        t: (key: string, defaultText: string) => string,
    ): void {
        const textBtnKey = 'ui.launcher.modules.modal.filter_text';
        const imageBtnKey = 'ui.launcher.modules.modal.filter_image';

        const filterContainer = document.createDocumentFragment();
        const btnTemplate = document.getElementById(
            'tpl-modal-filter-btn',
        ) as HTMLTemplateElement | null;

        if (btnTemplate) {
            this._appendFilterButton(
                filterContainer,
                btnTemplate,
                'filter-text-btn',
                'Filter Text',
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/></svg>`,
                textBtnKey,
                t(textBtnKey, 'Text'),
            );

            this._appendFilterButton(
                filterContainer,
                btnTemplate,
                'filter-image-btn',
                'Filter Image',
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
                imageBtnKey,
                t(imageBtnKey, 'Image'),
            );
        }

        actionsEl.innerHTML = '';
        actionsEl.appendChild(filterContainer);
        actionsEl.style.display = 'flex';
    }

    private _appendFilterButton(
        container: DocumentFragment,
        template: HTMLTemplateElement,
        id: string,
        ariaLabel: string,
        svgContent: string,
        i18nKey: string,
        text: string,
    ): void {
        const clone = template.content.cloneNode(true) as DocumentFragment;
        const btn = clone.querySelector('.category-filter-btn');
        if (!btn) return;

        btn.id = id;
        btn.setAttribute('aria-label', ariaLabel);

        const icon = btn.querySelector('.category-filter-icon');
        if (icon) icon.innerHTML = svgContent;

        const span = btn.querySelector('span');
        if (span) {
            span.dataset['i18n'] = i18nKey;
            span.textContent = text;
        }

        container.appendChild(clone);
    }

    private _bindFilterEvents(category: string): void {
        const textBtn = document.getElementById('filter-text-btn');
        const imageBtn = document.getElementById('filter-image-btn');

        const updateFilterUI = () => {
            if (textBtn) textBtn.classList.toggle('active', this._currentFilter === 'text');
            if (imageBtn) imageBtn.classList.toggle('active', this._currentFilter === 'image');
        };

        const applyFilter = (filterType: 'text' | 'image') => {
            if (this._currentFilter === filterType) return;
            this._currentFilter = filterType;
            updateFilterUI();

            const listEl = document.getElementById('app-modal-list');
            if (listEl) {
                // Smooth fade out
                listEl.style.transition =
                    'opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
                listEl.style.opacity = '0';
                listEl.style.transform = 'translateY(8px)';

                setTimeout(() => {
                    this._populateAppList(
                        listEl,
                        this._currentApps,
                        category,
                        this._currentSelectedAppId,
                    );

                    // Force reflow
                    listEl.getBoundingClientRect();

                    // Smooth fade in
                    listEl.style.opacity = '1';
                    listEl.style.transform = 'translateY(0)';
                }, 200);
            }
        };

        // Ensure listeners are not duplicated if called multiple times
        // A robust way mapping to simple clicks
        if (textBtn) {
            textBtn.onclick = () => applyFilter('text');
        }

        if (imageBtn) {
            imageBtn.onclick = () => applyFilter('image');
        }

        // Initial UI state
        updateFilterUI();
    }

    private _populateAppList(
        listEl: HTMLElement,
        apps: IApp[],
        category: string,
        selectedAppId: string | null,
    ): void {
        listEl.innerHTML = '';

        let filteredApps = apps;
        if (category === 'ai') {
            // Apply filtering: currently, all existing apps are mapped to 'text', and 'image' is empty
            filteredApps = apps.filter((_app) => {
                // In the future this should check app capability metadata
                return this._currentFilter === 'text';
            });
        }

        const sorted = this._getSortedApps(filteredApps);

        if (sorted.length === 0) {
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
            return;
        }

        sorted.forEach((app) => {
            const isSelected = selectedAppId !== null && app.id === selectedAppId;
            const card = this._cardRenderer.createCard(app, category, isSelected, (e, a) =>
                this._onAppInteraction(e, a, category),
            );
            listEl.appendChild(card);
        });
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

        const win = getGlobalWin();

        // Phase 1: fade out
        btn.style.transition = 'opacity 0.15s ease';
        btn.style.opacity = '0';

        setTimeout(() => {
            // Phase 2: swap class & text while invisible
            if (isSelected) {
                btn.className = 'modal-btn modal-btn-secondary';
                const key = 'ui.launcher.modules.modal.btn_remove';
                btn.dataset['i18n'] = key;
                btn.textContent = typeof win.t === 'function' ? win.t(key, 'Remove') : 'Remove';
            } else {
                btn.className = 'modal-btn modal-btn-primary';
                const key = 'ui.launcher.modules.modal.btn_select';
                btn.dataset['i18n'] = key;
                btn.textContent = typeof win.t === 'function' ? win.t(key, 'Select') : 'Select';
            }

            // Phase 3: fade in
            btn.style.opacity = '1';
        }, 150);
    }

    private _getSortedApps(apps: IApp[]): IApp[] {
        const priority = ['axelate', 'gpt', 'gemini'];
        return [...apps].sort((a, b) => {
            const nameA = (a.name ?? '').toLowerCase();
            const nameB = (b.name ?? '').toLowerCase();
            const getP = (n: string): number => {
                const idx = priority.findIndex((p) => n.includes(p));
                return idx === -1 ? 999 : idx;
            };
            const priorityDiff = getP(nameA) - getP(nameB);
            if (priorityDiff !== 0) return priorityDiff;
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
