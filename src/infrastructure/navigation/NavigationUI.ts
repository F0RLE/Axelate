/**
 * @module core/ui/NavigationUI
 * @description Centralized UI management for page navigation and sidebar button state.
 *
 * @example
 * ```typescript
 * const navUI = new NavigationUI(navigationService);
 * await navUI.showPage('settings');
 * ```
 */

import { eventBus } from '@/shared/services/EventBus';
import { type NavigationService } from './NavigationService';
import { type SoundService } from '@/shared/services/SoundService';
import { tracer } from '@/infrastructure/logging/LoggerService';

export class NavigationUI {
    private _mouseUpHandler: ((e: MouseEvent) => void) | null = null;
    private _keyDownHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(
        private readonly _service: NavigationService,
        private readonly _sounds?: SoundService,
    ) {}

    /**
     * Initializes click listeners for all [data-page] navigation buttons.
     * Re-binds listeners directly to ensure they work after template injection.
     */
    public init(): void {
        tracer.debug('[NavigationUI] Navigation initialized.');

        // 1. Delegate clicks on the sidebar wrapper rather than individual buttons
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const btn = target.closest('.nav-btn');
                if (btn instanceof HTMLElement) {
                    const pageId = btn.dataset['page'];
                    if (pageId !== undefined && pageId !== '') {
                        e.preventDefault();
                        void this.showPage(pageId, btn);
                    }
                }
            });
        }

        // 2. Bind global mouse navigation (Button 3 = Back, Button 4 = Forward)
        this._mouseUpHandler = (e: MouseEvent) => {
            if (e.button === 3) {
                // Back button
                e.preventDefault();
                if (this._service.popBackAction()) return;

                const backPageId = this._service.goBack();
                if (backPageId !== undefined && backPageId !== '') {
                    void this.showPage(backPageId, null, false, true);
                }
            } else if (e.button === 4) {
                // Forward button
                e.preventDefault();
                if (this._service.popForwardAction()) return;

                const forwardPageId = this._service.goForward();
                if (forwardPageId !== undefined && forwardPageId !== '') {
                    void this.showPage(forwardPageId, null, false, true);
                }
            }
        };

        // Bind global keyboard shortcuts (Escape = Back)
        this._keyDownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (this._service.popBackAction()) {
                    e.preventDefault();
                }
            }
        };

        globalThis.addEventListener('mouseup', this._mouseUpHandler);
        globalThis.addEventListener('keydown', this._keyDownHandler);
    }

    /**
     * Cleanup listeners.
     */
    public destroy(): void {
        if (this._mouseUpHandler) {
            globalThis.removeEventListener('mouseup', this._mouseUpHandler);
            this._mouseUpHandler = null;
        }
        if (this._keyDownHandler) {
            globalThis.removeEventListener('keydown', this._keyDownHandler);
            this._keyDownHandler = null;
        }
    }

    /**
     * Navigates to a specific page and updates UI state.
     *
     * @param pageId - Target page identifier
     * @param btn - Optional button element that triggered the navigation
     * @param silent - If true, prevents sound effects
     * @param isHistoryNav - If true, prevents pushing onto the history stack again
     */
    public showPage(
        pageId: string,
        btn: HTMLElement | null = null,
        silent = false,
        isHistoryNav = false,
    ): Promise<void> {
        tracer.debug(`[NavigationUI] nav -> ${pageId}`, { hasBtn: !!btn, isHistoryNav });
        const previousPageId = this._service.getCurrentPage();

        // 1. Play Sound
        if (!silent && this._sounds) {
            this._sounds.playToggle(true);
        }

        // 2. Hide all pages & Reset Sidebar
        // Performance note: querySelectorAll is fast enough for this infrequent operation
        const pages = document.querySelectorAll('.page');
        const navBtns = document.querySelectorAll('.nav-btn');

        pages.forEach((el: Element) => {
            el.classList.remove('active');
        });
        navBtns.forEach((b: Element) => {
            b.classList.remove('active');
            b.removeAttribute('aria-current');
        });

        // Emit navigation event
        const navPayload: { pageId: string; previousPageId?: string } = { pageId };
        if (previousPageId !== undefined) navPayload.previousPageId = previousPageId;
        eventBus.emit('page:change', navPayload);

        // 3. Show target page
        const target = document.getElementById(pageId) ?? document.getElementById(`page-${pageId}`);

        if (target) {
            target.classList.add('active');
            this._service.setCurrentPage(pageId, isHistoryNav);
        } else {
            tracer.warn(`[NavigationUI] Page not found: ${pageId}`);
        }

        // 4. Update Sidebar Buttons
        if (btn) {
            btn.classList.add('active');
            btn.setAttribute('aria-current', 'page');
        } else {
            navBtns.forEach((b) => {
                const el = b as HTMLElement;
                if (el.dataset['page'] === pageId) {
                    el.classList.add('active');
                    el.setAttribute('aria-current', 'page');
                }
            });
        }
        return Promise.resolve();
    }
}
