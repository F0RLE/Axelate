import type { IApp } from '../../types/coreTypes';
import type { TGlobalWin } from '../../types/global_bridge_types';
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

    public openAppSelection(category: string, apps: IApp[]): void {
        const modal = document.getElementById('app-selection-modal');
        const listEl = document.getElementById('app-modal-list');

        logger.info(
            `[ModalManager] Opening selection modal for ${category} with ${String(apps.length)} items.`,
        );

        if (modal === null || listEl === null) return;

        this._currentCategory = category;
        this._currentApps = apps;

        // Reset filter when opening new category
        this._currentFilter = 'text';

        this._updateAppModalTitle(category);
        this._updateSidebar(category);
        this._populateAppList(listEl, apps, category);

        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        // Calculate needed width for any language dynamically
        this._updateDynamicSidebarWidth();

        // Add smooth hiding for main content
        const container = document.querySelector('.models-container');
        if (container !== null) container.classList.add('content-hidden');

        // Register back action for mouse/keyboard global navigation
        NavigationService.getInstance().pushBackAction('app-selection-modal', () => {
            this.closeAppSelection();
        });

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
        const modal = document.getElementById('app-selection-modal');
        if (modal !== null) {
            modal.classList.add('hidden');
            setTimeout(() => {
                modal.style.display = 'none';
            }, 300);

            // Restore main content visibility
            const container = document.querySelector('.models-container');
            if (container !== null) container.classList.remove('content-hidden');
        }
    }

    public refreshCurrentSelection(): void {
        if (this._currentCategory !== null && this._currentApps.length > 0) {
            const modal = document.getElementById('app-selection-modal');
            if (modal !== null && !modal.classList.contains('hidden')) {
                this.openAppSelection(this._currentCategory, this._currentApps);
            }
        }
    }

    // --- Helpers ---

    private _updateAppModalTitle(category: string): void {
        const titleEl = document.getElementById('app-modal-title');
        if (titleEl === null) return;

        const key =
            category === 'ai'
                ? 'ui.launcher.modules.modal.ai_title'
                : 'ui.launcher.modules.modal.services_title';
        const defaultText = category === 'ai' ? 'Select AI Module' : 'Select Service';
        const win = globalThis as TGlobalWin;

        titleEl.textContent = typeof win.t === 'function' ? win.t(key, defaultText) : defaultText;
    }

    private _updateSidebar(category: string): void {
        const sidebar = document.getElementById('app-modal-sidebar');
        const iconContainer = document.getElementById('app-modal-sidebar-icon');
        const titleEl = document.getElementById('app-modal-sidebar-title');
        const descEl = document.getElementById('app-modal-sidebar-desc');
        const actionsEl = document.getElementById('app-modal-sidebar-actions');

        if (!sidebar || !iconContainer || !titleEl || !descEl || !actionsEl) return;

        const win = globalThis as TGlobalWin;
        const t = (key: string, defaultText: string) =>
            typeof win.t === 'function' ? win.t(key, defaultText) : defaultText;

        sidebar.classList.remove('hidden');

        if (category === 'ai') {
            iconContainer.innerHTML = '';
            iconContainer.style.display = 'none';

            titleEl.textContent = '';
            titleEl.style.display = 'none';

            // Hide description to keep things minimal
            descEl.textContent = '';
            descEl.style.display = 'none';

            // Inject simple static buttons
            const textBtnKey = 'ui.launcher.modules.modal.filter_text';
            const imageBtnKey = 'ui.launcher.modules.modal.filter_image';

            actionsEl.innerHTML = `
                <div class="category-filter-btn" id="filter-text-btn" role="button" aria-label="Filter Text">
                    <div class="category-filter-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/></svg>
                    </div>
                    <span data-i18n="${textBtnKey}">${t(textBtnKey, 'Text')}</span>
                </div>
                <div class="category-filter-btn" id="filter-image-btn" role="button" aria-label="Filter Image">
                    <div class="category-filter-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                    </div>
                    <span data-i18n="${imageBtnKey}">${t(imageBtnKey, 'Image')}</span>
                </div>
            `;
            actionsEl.style.display = 'flex';

            // Bind filter events
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
                        this._populateAppList(listEl, this._currentApps, category);

                        // Force reflow
                        listEl.getBoundingClientRect();

                        // Smooth fade in
                        listEl.style.opacity = '1';
                        listEl.style.transform = 'translateY(0)';
                    }, 200);
                }
            };

            if (textBtn) {
                textBtn.addEventListener('click', () => applyFilter('text'));
            }

            if (imageBtn) {
                imageBtn.addEventListener('click', () => applyFilter('image'));
            }

            // Initial UI state
            updateFilterUI();
        } else {
            iconContainer.innerHTML =
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
            iconContainer.style.display = 'flex';

            const titleKey = 'ui.launcher.modules.modal.services_sidebar_title';
            const descKey = 'ui.launcher.modules.modal.services_sidebar_desc';
            const defaultTitle = 'Bots & Services';
            const defaultDesc =
                'Connect external services and manage autonomous bots acting on your behalf.';

            titleEl.textContent = t(titleKey, defaultTitle);
            titleEl.dataset['i18n'] = titleKey;
            titleEl.style.display = 'block';

            descEl.textContent = t(descKey, defaultDesc);
            descEl.dataset['i18n'] = descKey;
            descEl.style.display = 'block';

            // Clear actions for services
            actionsEl.innerHTML = '';
            actionsEl.style.display = 'none';
        }
    }

    private _populateAppList(listEl: HTMLElement, apps: IApp[], category: string): void {
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
            listEl.innerHTML = `
                <div style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4rem 0; color: var(--text-muted); opacity: 0.7;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 1rem;"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                    <span data-i18n="ui.launcher.modules.modal.no_apps_filter" style="font-size: 1.1rem;">No applications found for this type</span>
                </div>
            `;
            return;
        }

        sorted.forEach((app) => {
            const card = this._cardRenderer.createCard(app, category, (e, a) =>
                this._onAppInteraction(e, a, category),
            );
            listEl.appendChild(card);
        });
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
