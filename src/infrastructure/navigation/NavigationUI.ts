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

import type { EventBus } from '@/shared/services/EventBus';
import { type NavigationService } from './NavigationService';
import { type SoundService } from '@/shared/services/SoundService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

type NavigationRuntime = {
    addWindowListener: typeof globalThis.addEventListener;
    removeWindowListener: typeof globalThis.removeEventListener;
};

type SideMouseEventType = 'mousedown' | 'mouseup';

type SideMouseEventRecord = {
    button: number;
    handledAt: number;
    type: SideMouseEventType;
};

type NavigationListenerBinding = {
    type: keyof WindowEventMap;
    handler: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
};

function createDefaultNavigationRuntime(): NavigationRuntime {
    return {
        addWindowListener: globalThis.addEventListener.bind(globalThis),
        removeWindowListener: globalThis.removeEventListener.bind(globalThis),
    };
}

export class NavigationUI {
    private static readonly _SIDE_MOUSE_DEDUP_WINDOW_MS = 250;
    private _lastHandledSideMouseEvent: SideMouseEventRecord | null = null;
    private _mouseDownHandler: ((e: MouseEvent) => void) | null = null;
    private _mouseUpHandler: ((e: MouseEvent) => void) | null = null;
    private _auxClickHandler: ((e: MouseEvent) => void) | null = null;
    private _keyDownHandler: ((e: KeyboardEvent) => void) | null = null;
    private _initialized = false;
    private static readonly _BACK_BUTTON = 3;
    private static readonly _FORWARD_BUTTON = 4;
    private static readonly _CAPTURE_OPTIONS = true;

    constructor(
        private readonly _service: NavigationService,
        private readonly _eventBus: EventBus,
        private readonly _tracer: LoggerService,
        private readonly _sounds?: SoundService,
        private readonly _runtime: NavigationRuntime = createDefaultNavigationRuntime(),
    ) {}

    /**
     * Initializes non-click navigation handlers.
     * Page-button click delegation is owned by `EventHandler`.
     */
    public init(): void {
        if (this._initialized) return;
        this._initialized = true;
        this._tracer.debug('[NavigationUI] Navigation initialized.');

        this._bindWindowHandlers();
        this._applyWindowBindings('addWindowListener');
    }

    private _suppressNativeSideMouseNavigation(e: MouseEvent): void {
        if (!this._shouldHandleMouseNavigation(e)) return;

        this._consumeMouseEvent(e);
    }

    private _handleMouseNavigation(e: MouseEvent): void {
        if (!this._shouldHandleMouseNavigation(e)) return;

        if (this._isDuplicateSideMouseEvent(e)) {
            this._consumeMouseEvent(e);
            return;
        }

        const isTextEntryTarget = this._isTextEntryTarget(e.target);

        if (e.button === NavigationUI._BACK_BUTTON) {
            this._handleBackMouseNavigation(e, isTextEntryTarget);
            return;
        }

        if (this._shouldBlockPageHistoryNavigation(isTextEntryTarget)) {
            this._consumeMouseEvent(e);
            return;
        }

        this._consumeMouseEvent(e);
        const pageId = this._service.goForward();
        if (pageId !== undefined && pageId !== '') {
            this._navigateHistory(pageId);
            return;
        }

        this._service.popForwardAction();
    }

    private _handleBackMouseNavigation(e: MouseEvent, isTextEntryTarget: boolean): void {
        if (this._service.popBackAction()) {
            this._consumeMouseEvent(e);
            return;
        }

        if (this._shouldBlockPageHistoryNavigation(isTextEntryTarget)) {
            this._consumeMouseEvent(e);
            return;
        }

        this._consumeMouseEvent(e);
        this._navigateHistory(this._service.goBack());
    }

    private _isDuplicateSideMouseEvent(e: MouseEvent): boolean {
        const timestamp = performance.now();
        const previous = this._lastHandledSideMouseEvent;
        const currentType: SideMouseEventType = e.type === 'mouseup' ? 'mouseup' : 'mousedown';

        if (
            previous !== null &&
            previous.button === e.button &&
            previous.type !== currentType &&
            timestamp - previous.handledAt < NavigationUI._SIDE_MOUSE_DEDUP_WINDOW_MS
        ) {
            return true;
        }

        this._lastHandledSideMouseEvent = {
            button: e.button,
            handledAt: timestamp,
            type: currentType,
        };
        return false;
    }

    private _shouldHandleMouseNavigation(e: MouseEvent): boolean {
        if (e.defaultPrevented) return false;
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
        return e.button === NavigationUI._BACK_BUTTON || e.button === NavigationUI._FORWARD_BUTTON;
    }

    private _shouldBlockPageHistoryNavigation(isTextEntryTarget: boolean): boolean {
        return isTextEntryTarget || this._hasOpenDialog();
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

    private _consumeMouseEvent(e: MouseEvent): void {
        e.preventDefault();
        e.stopPropagation();
    }

    /**
     * Cleanup listeners.
     */
    public destroy(): void {
        this._lastHandledSideMouseEvent = null;
        this._applyWindowBindings('removeWindowListener');
        this._clearWindowHandlers();
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
        this._tracer.debug(`[NavigationUI] nav -> ${pageId}`, { hasBtn: !!btn, isHistoryNav });
        const previousPageId = this._service.getCurrentPage();

        if (!silent && this._sounds) {
            this._sounds.playToggle(true);
        }

        const navBtns = this._resetPageAndNavigationState();
        const target = this._findPageElement(pageId);

        if (target === null) {
            this._tracer.warn(`[NavigationUI] Page not found: ${pageId}`);
            return Promise.resolve();
        }

        this._activatePage(target, pageId, previousPageId, isHistoryNav);
        this._activateNavigationButton(navBtns, pageId, btn);
        return Promise.resolve();
    }

    public syncActiveNavigationButton(pageId: string): void {
        const navBtns = document.querySelectorAll('.nav-btn');
        this._activateNavigationButton(navBtns, pageId, null);
    }

    private _bindWindowHandlers(): void {
        this._mouseDownHandler = (e: MouseEvent) => {
            this._handleMouseNavigation(e);
        };
        this._mouseUpHandler = (e: MouseEvent) => {
            this._handleMouseNavigation(e);
        };
        this._auxClickHandler = (e: MouseEvent) => {
            this._suppressNativeSideMouseNavigation(e);
        };
        this._keyDownHandler = (e: KeyboardEvent) => {
            this._handleKeyDown(e);
        };
    }

    private _handleKeyDown(e: KeyboardEvent): void {
        if (e.key !== 'Escape') return;
        if (e.defaultPrevented || this._isTextEntryTarget(e.target)) return;

        if (this._service.popBackAction()) {
            e.preventDefault();
        }
    }

    private _applyWindowBindings(
        method: keyof Pick<NavigationRuntime, 'addWindowListener' | 'removeWindowListener'>,
    ): void {
        this._getWindowListenerBindings().forEach((binding) => {
            this._runtime[method](binding.type, binding.handler, binding.options);
        });
    }

    private _getWindowListenerBindings(): NavigationListenerBinding[] {
        return [
            {
                type: 'mousedown',
                handler: this._mouseDownHandler as EventListener,
                options: NavigationUI._CAPTURE_OPTIONS,
            },
            {
                type: 'mouseup',
                handler: this._mouseUpHandler as EventListener,
                options: NavigationUI._CAPTURE_OPTIONS,
            },
            {
                type: 'auxclick',
                handler: this._auxClickHandler as EventListener,
                options: NavigationUI._CAPTURE_OPTIONS,
            },
            {
                type: 'keydown',
                handler: this._keyDownHandler as EventListener,
            },
        ];
    }

    private _clearWindowHandlers(): void {
        this._mouseDownHandler = null;
        this._mouseUpHandler = null;
        this._auxClickHandler = null;
        this._keyDownHandler = null;
    }

    private _resetPageAndNavigationState(): NodeListOf<Element> {
        const pages = document.querySelectorAll('.page');
        const navBtns = document.querySelectorAll('.nav-btn');

        pages.forEach((el) => {
            el.classList.remove('active');
        });
        navBtns.forEach((btn) => {
            btn.classList.remove('active');
            btn.removeAttribute('aria-current');
        });

        return navBtns;
    }

    private _findPageElement(pageId: string): HTMLElement | null {
        const target = document.getElementById(pageId) ?? document.getElementById(`page-${pageId}`);
        return target instanceof HTMLElement ? target : null;
    }

    private _activatePage(
        target: HTMLElement,
        pageId: string,
        previousPageId: string | undefined,
        isHistoryNav: boolean,
    ): void {
        target.classList.add('active');
        this._service.setCurrentPage(pageId, isHistoryNav);

        const navPayload: { pageId: string; previousPageId?: string } = { pageId };
        if (previousPageId !== undefined) {
            navPayload.previousPageId = previousPageId;
        }
        this._eventBus.emit('page:change', navPayload);
    }

    private _activateNavigationButton(
        navBtns: NodeListOf<Element>,
        pageId: string,
        triggerButton: HTMLElement | null,
    ): void {
        if (triggerButton instanceof HTMLElement) {
            triggerButton.classList.add('active');
            triggerButton.setAttribute('aria-current', 'page');
            return;
        }

        navBtns.forEach((btn) => {
            if (!(btn instanceof HTMLElement) || btn.dataset['page'] !== pageId) {
                return;
            }

            btn.classList.add('active');
            btn.setAttribute('aria-current', 'page');
        });
    }
}
