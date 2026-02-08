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
import { logger } from '@/shared/services/LoggerService';

export class NavigationUI {
    constructor(
        private readonly _service: NavigationService,
        private readonly _sounds?: SoundService,
    ) {}

    /**
     * Initializes click listeners for all [data-page] navigation buttons.
     * Re-binds listeners directly to ensure they work after template injection.
     */
    public init(): void {
        logger.debug('[NavigationUI] Navigation initialized (pure service mode).');
    }

    /**
     * Cleanup listeners.
     */
    public destroy(): void {
        // No internal listeners to clean up (delegated to EventHandler)
    }

    /**
     * Navigates to a specific page and updates UI state.
     *
     * @param pageId - Target page identifier
     * @param btn - Optional button element that triggered the navigation
     * @param silent - If true, prevents sound effects
     */
    public showPage(pageId: string, btn: HTMLElement | null = null, silent = false): Promise<void> {
        logger.debug(`[NavigationUI] nav -> ${pageId}`, { hasBtn: !!btn });
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
            this._service.setCurrentPage(pageId);
        } else {
            logger.warn(`[NavigationUI] Page not found: ${pageId}`);
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
