const DEVTOOLS_SHORTCUT_KEYS = ['I', 'J', 'C'] as const;
const RELOAD_SHORTCUT_KEYS = ['r', 'R', 'к', 'К'] as const;
const BLOCKED_CTRL_KEYS = ['u', 'p', 's', 'f', 'g'] as const;
const ZOOM_FRAME_DELAY_MS = 16;
const ZOOM_PERSIST_INTERVAL_MS = 10_000;
const MIN_WHEEL_ZOOM_STEP = 0.02;
const MAX_WHEEL_ZOOM_STEP = 0.08;
const BASE_WHEEL_DELTA = 120;

type WindowUiInteractionRuntime = {
    addWindowListener: typeof globalThis.addEventListener;
    reload: () => void;
};

type WindowUiInteractionDeps = {
    runtime: WindowUiInteractionRuntime;
    toggleMaximize: () => Promise<void>;
    changeZoom: (delta: number) => Promise<void>;
    persistZoom: () => Promise<void>;
    setMonitoringPaused: (paused: boolean) => Promise<void>;
    hasOpenDialog: () => boolean;
    isInGracePeriod: () => boolean;
    onZoomChanged: () => void;
    onResize: () => void;
};

export class WindowUiInteractionController {
    private _pendingZoomDelta = 0;
    private _zoomTimer: ReturnType<typeof setTimeout> | null = null;
    private _zoomPersistTimer: ReturnType<typeof setTimeout> | null = null;
    private _hasPendingZoomPersist = false;

    constructor(private readonly _deps: WindowUiInteractionDeps) {}

    public bind(signal: AbortSignal): ReturnType<typeof setTimeout> {
        signal.addEventListener(
            'abort',
            () => {
                if (this._zoomTimer !== null) {
                    clearTimeout(this._zoomTimer);
                    this._zoomTimer = null;
                }
                if (this._zoomPersistTimer !== null) {
                    clearTimeout(this._zoomPersistTimer);
                    this._zoomPersistTimer = null;
                }
                this._hasPendingZoomPersist = false;
                this._pendingZoomDelta = 0;
            },
            { once: true },
        );

        document.addEventListener(
            'contextmenu',
            (e) => {
                const target = e.target as HTMLElement;
                if (this._shouldAllowContextMenu(target)) {
                    return;
                }
                e.preventDefault();
            },
            { capture: true, signal },
        );

        const updateMonitoring = (): void => {
            const shouldPause =
                !this._deps.isInGracePeriod() && (document.hidden || !document.hasFocus());
            void this._deps.setMonitoringPaused(shouldPause);
        };
        document.addEventListener('visibilitychange', updateMonitoring, { signal });
        this._deps.runtime.addWindowListener('blur', updateMonitoring, { signal });
        this._deps.runtime.addWindowListener('focus', updateMonitoring, { signal });

        document.addEventListener(
            'keydown',
            (e) => {
                this._handleKeydown(e);
            },
            { capture: true, signal },
        );

        document.addEventListener(
            'wheel',
            (e: Event) => {
                const ev = e as WheelEvent;
                if (ev.ctrlKey) {
                    ev.preventDefault();
                    const delta = this._getWheelZoomDelta(ev.deltaY);
                    this._scheduleZoomChange(delta);
                }
            },
            { passive: false, signal },
        );

        this._bindSelectionPrevention(signal);
        this._deps.runtime.addWindowListener('resize', this._deps.onResize, { signal });

        return setTimeout(updateMonitoring, 1000);
    }

    private _scheduleZoomChange(delta: number): void {
        this._pendingZoomDelta += delta;
        if (this._zoomTimer !== null) {
            return;
        }

        this._zoomTimer = setTimeout(() => {
            const pendingZoomDelta = this._pendingZoomDelta;
            this._pendingZoomDelta = 0;
            this._zoomTimer = null;

            if (pendingZoomDelta === 0) {
                return;
            }

            this._deps
                .changeZoom(pendingZoomDelta)
                .then(() => {
                    this._deps.onZoomChanged();
                    this._scheduleZoomPersist();
                })
                .catch(() => {
                    /* ignore */
                });
        }, ZOOM_FRAME_DELAY_MS);
    }

    private _scheduleZoomPersist(): void {
        this._hasPendingZoomPersist = true;
        if (this._zoomPersistTimer !== null) {
            return;
        }

        this._zoomPersistTimer = setTimeout(() => {
            this._zoomPersistTimer = null;
            if (!this._hasPendingZoomPersist) {
                return;
            }
            this._hasPendingZoomPersist = false;
            this._deps.persistZoom().catch(() => {
                /* ignore */
            });
        }, ZOOM_PERSIST_INTERVAL_MS);
    }

    private _getWheelZoomDelta(deltaY: number): number {
        if (deltaY === 0) {
            return 0;
        }

        const intensity = Math.min(Math.abs(deltaY) / BASE_WHEEL_DELTA, 1);
        const step = MIN_WHEEL_ZOOM_STEP + (MAX_WHEEL_ZOOM_STEP - MIN_WHEEL_ZOOM_STEP) * intensity;

        return deltaY < 0 ? step : -step;
    }

    private _handleKeydown(e: KeyboardEvent): void {
        if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
            return;
        }

        if (
            e.key === 'F12' ||
            (e.ctrlKey &&
                e.shiftKey &&
                DEVTOOLS_SHORTCUT_KEYS.includes(e.key.toUpperCase() as never))
        ) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (this._isReloadShortcut(e)) {
            e.preventDefault();
            this._deps.runtime.reload();
            return;
        }

        if (this._deps.hasOpenDialog() && this._isWindowShortcut(e)) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (e.key === 'F11') {
            e.preventDefault();
            this._deps.toggleMaximize().catch(() => {
                /* ignore */
            });
            return;
        }

        if (e.ctrlKey && BLOCKED_CTRL_KEYS.includes(e.key.toLowerCase() as never)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    private _shouldAllowContextMenu(target: HTMLElement | null): boolean {
        if (!(target instanceof Element)) return false;

        if (target.closest('.allow-context-menu')) return true;

        return (
            target.closest(
                'input, textarea, select, option, [contenteditable="true"], [role="textbox"]',
            ) !== null
        );
    }

    private _isWindowShortcut(e: KeyboardEvent): boolean {
        if (e.key === 'F11' || e.key === 'F5') return true;
        if (this._isReloadShortcut(e)) return true;
        return e.ctrlKey && BLOCKED_CTRL_KEYS.includes(e.key.toLowerCase() as never);
    }

    private _isReloadShortcut(e: KeyboardEvent): boolean {
        return e.key === 'F5' || (e.ctrlKey && RELOAD_SHORTCUT_KEYS.includes(e.key as never));
    }

    private _bindSelectionPrevention(signal: AbortSignal): void {
        const allowedSelectors =
            'input, textarea, .console-logs-area, [contenteditable], .chat-bubble, .selectable';

        document.addEventListener(
            'selectstart',
            (e: Event) => {
                const target = e.target as HTMLElement;
                if (target instanceof Element && target.closest(allowedSelectors)) {
                    return;
                }
                e.preventDefault();
            },
            { signal },
        );

        document.addEventListener(
            'mousedown',
            (e: Event) => {
                const ev = e as MouseEvent;
                const target = ev.target as HTMLElement;
                if (target instanceof Element && target.closest(allowedSelectors)) {
                    return;
                }
                if (ev.detail > 1) {
                    ev.preventDefault();
                }
            },
            { signal },
        );
    }
}
