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
    private _initialized = false;
    private static readonly _BACK_BUTTON = 3;
    private static readonly _FORWARD_BUTTON = 4;

    constructor(
        private readonly _service: NavigationService,
        private readonly _sounds?: SoundService,
    ) {}

    /**
     * Initializes non-click navigation handlers.
     * Page-button click delegation is owned by `EventHandler`.
     */
    public init(): void {
        if (this._initialized) return;
        this._initialized = true;
        tracer.debug('[NavigationUI] Navigation initialized.');

        // Bind global mouse navigation (Button 3 = Back, Button 4 = Forward)
        this._mouseUpHandler = (e: MouseEvent) => {
            this._handleMouseNavigation(e);
        };

        // Bind global keyboard shortcuts (Escape = Back)
        this._keyDownHandler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (e.defaultPrevented || this._isTextEntryTarget(e.target)) return;

            if (this._service.popBackAction()) {
                e.preventDefault();
            }
        };

        globalThis.addEventListener('mouseup', this._mouseUpHandler);
        globalThis.addEventListener('keydown', this._keyDownHandler);
    }

    private _handleMouseNavigation(e: MouseEvent): void {
        if (!this._shouldHandleMouseNavigation(e)) return;

        if (e.button === NavigationUI._BACK_BUTTON) {
            if (this._service.popBackAction()) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            if (this._hasOpenDialog()) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            this._navigateHistory(this._service.goBack());
            return;
        }

        if (this._service.popForwardAction()) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (this._hasOpenDialog()) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        this._navigateHistory(this._service.goForward());
    }

    private _shouldHandleMouseNavigation(e: MouseEvent): boolean {
        if (e.defaultPrevented) return false;
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
        if (this._isTextEntryTarget(e.target)) return false;
        return e.button === NavigationUI._BACK_BUTTON || e.button === NavigationUI._FORWARD_BUTTON;
    }

    private _isTextEntryTarget(target: EventTarget | null): boolean {
        if (!(target instanceof Element)) return false;

        if (target.closest('[contenteditable="true"]')) return true;

        return target.closest('input, textarea, select, option, [role="textbox"]') !== null;
    }

    private _hasOpenDialog(): boolean {
        return document.querySelector('dialog[open]:not(.hidden)') !== null;
    }

    private _navigateHistory(pageId: string | undefined): void {
        if (pageId !== undefined && pageId !== '') {
            void this.showPage(pageId, null, false, true);
        }
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
        this._initialized = false;
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

        // 3. Show target page
        const target = document.getElementById(pageId) ?? document.getElementById(`page-${pageId}`);

        if (target) {
            target.classList.add('active');
            this._service.setCurrentPage(pageId, isHistoryNav);

            const navPayload: { pageId: string; previousPageId?: string } = { pageId };
            if (previousPageId !== undefined) navPayload.previousPageId = previousPageId;
            eventBus.emit('page:change', navPayload);
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
