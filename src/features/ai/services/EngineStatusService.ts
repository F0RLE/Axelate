import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { EngineStatusContext } from './AIBridgeContext';

type EngineStatusLogger = Pick<LoggerService, 'info' | 'error'>;

type EngineState = 'idle' | 'starting' | 'swapping' | 'ready' | 'error';

interface EngineSwappingPayload {
    from: string;
    to: string;
}

interface EngineReadyPayload {
    engine_id: string;
    endpoint: string;
}

interface EngineErrorPayload {
    engine_id: string;
    message: string;
}

interface EngineStartingPayload {
    engine_id: string;
}

/**
 * @class EngineStatusService
 * @description Listens to Tauri `ai:engine:*` events and:
 *  1. Updates CSS state classes on engine cards
 *  2. Tracks active engine slots (engine_id → endpoint)
 *  3. Updates the `+N` multi-slot badge on `#ai-module-card`
 *
 * Follows the same listener pattern as AIChatTransport.
 */
export class EngineStatusService {
    private _context: EngineStatusContext | null = null;
    private readonly _unlisteners: (() => void)[] = [];
    private _initialized = false;

    public constructor(private readonly _tracer: EngineStatusLogger) {}

    /** engine_id → endpoint for all currently-ready engines */
    private readonly _activeSlots = new Map<string, string>();

    public setContext(context: EngineStatusContext): void {
        this._context = context;
    }

    public setCore(context: EngineStatusContext): void {
        this.setContext(context);
    }

    public init(): void {
        if (this._initialized) {
            return;
        }
        if (this._context?.tauriProvider.isTauri() !== true) return;

        this._unlisteners.push(
            this._listen<EngineSwappingPayload>('ai:engine:swapping', (payload) => {
                this._tracer.info(`[EngineStatus] Swapping from ${payload.from} to ${payload.to}`);
                this._activeSlots.delete(payload.from);
                this.setEngineState(payload.from, 'idle');
                this.setEngineState(payload.to, 'swapping');
                this._updateBadge();
            }),
            this._listen<EngineStartingPayload>('ai:engine:starting', (payload) => {
                this._tracer.info(`[EngineStatus] Starting ${payload.engine_id}`);
                this.setEngineState(payload.engine_id, 'starting');
            }),
            this._listen<EngineReadyPayload>('ai:engine:ready', (payload) => {
                this._tracer.info(
                    `[EngineStatus] Ready: ${payload.engine_id} @ ${payload.endpoint}`,
                );
                this._activeSlots.set(payload.engine_id, payload.endpoint);
                this.setEngineState(payload.engine_id, 'ready');
                this._updateBadge();
            }),
            this._listen<EngineErrorPayload>('ai:engine:error', (payload) => {
                this._tracer.error(
                    `[EngineStatus] Error on ${payload.engine_id}: ${payload.message}`,
                );
                this._activeSlots.delete(payload.engine_id);
                this.setEngineState(payload.engine_id, 'error');
                this._updateBadge();
            }),
        );

        this._tracer.info('[EngineStatusService] Listening for engine events');
        this._initialized = true;
    }

    public destroy(): void {
        this._unlisteners.forEach((fn) => fn());
        this._unlisteners.length = 0;
        this._activeSlots.clear();
        this._initialized = false;
    }

    /** Returns a snapshot of all currently active engine IDs */
    public get activeEngineIds(): string[] {
        return Array.from(this._activeSlots.keys());
    }

    /**
     * Returns the HTTP endpoint for a running engine, or undefined if not active/healthy.
     * @param engineId - The engine ID (e.g. 'llamacpp', 'sdcpp')
     */
    public getEndpointForEngine(engineId: string): string | undefined {
        return this._activeSlots.get(engineId);
    }

    /**
     * Returns true if any engine is currently in the ready state.
     */
    public get hasActiveEngines(): boolean {
        return this._activeSlots.size > 0;
    }

    public setEngineState(engineId: string, state: EngineState): void {
        if (state !== 'ready') {
            this._activeSlots.delete(engineId);
        }

        this._setCardState(engineId, state);
        this._setDashboardCardState(engineId, state);
    }

    /**
     * Called by AppUI._updateMultiSlotBadge() which now owns the badge DOM.
     * This method is intentionally a no-op here — the badge is fully managed by AppUI.
     */
    private _updateBadge(): void {
        // Badge DOM is owned by AppUI._updateMultiSlotBadge()
        // No action needed here — AppUI subscribes to slot changes via _selectedApps
    }

    /** Updates all cards matching `engineId` with the given state class. */
    private _setCardState(engineId: string, state: EngineState): void {
        const escapedEngineId = this._escapeSelectorValue(engineId);
        const cards = document.querySelectorAll<HTMLElement>(`[data-app-id="${escapedEngineId}"]`);

        cards.forEach((card) => {
            this._resetCardClasses(card);
            card.classList.add(`engine-${state}`);

            if (card.classList.contains('selected')) {
                this._updateCardButton(card, state);
            }
        });
    }

    private _setDashboardCardState(engineId: string, state: EngineState): void {
        const escapedEngineId = this._escapeSelectorValue(engineId);
        const cards = document.querySelectorAll<HTMLElement>(
            `[data-current-module="${escapedEngineId}"]`,
        );

        cards.forEach((card) => {
            const isRunning = state === 'ready';
            card.dataset['runtimeStatus'] = isRunning ? 'running' : state;
            card.classList.toggle('module-running', isRunning);
            card.classList.toggle('module-stopped', !isRunning);
        });
    }

    private _escapeSelectorValue(value: string): string {
        const cssApi = (globalThis as { CSS?: { escape?: (selector: string) => string } }).CSS;
        if (typeof cssApi?.escape === 'function') {
            return cssApi.escape(value);
        }

        return value.replace(/["\\]/gu, '\\$&');
    }

    private _resetCardClasses(card: HTMLElement): void {
        card.classList.remove(
            'engine-idle',
            'engine-starting',
            'engine-swapping',
            'engine-ready',
            'engine-error',
        );
    }

    private _updateCardButton(card: HTMLElement, state: EngineState): void {
        const btn = card.querySelector<HTMLButtonElement>(
            '.module-selection-card-actions button.modal-btn',
        );
        if (!btn) return;

        if (state === 'starting' || state === 'swapping') {
            btn.classList.add('active-module-btn');
            btn.classList.remove('stop-btn');
            btn.textContent = this._translate(
                'ui.launcher.modules.modal.btn_booting',
                'Booting...',
            );
        } else if (state === 'ready') {
            btn.classList.remove('active-module-btn', 'stop-btn');
            btn.textContent = this._translate('ui.launcher.modules.modal.btn_remove', 'Убрать');
        } else {
            btn.classList.remove('active-module-btn', 'stop-btn');
            btn.textContent = this._translate('ui.launcher.modules.modal.btn_remove', 'Убрать');
        }
    }

    private _translate(key: string, fallback: string): string {
        return this._context?.i18n.t(key, fallback) ?? fallback;
    }

    /** Creates a typed Tauri event listener, returns unlisten fn. */
    private _listen<T>(event: string, handler: (payload: T) => void): () => void {
        if (this._context?.tauriProvider.isTauri() !== true) return () => {};

        let unlistenFn: (() => void) | undefined;
        let isActive = true;

        const listenPromise = this._context.tauriProvider
            .listen<T>(event, (payload: T) => {
                if (isActive) handler(payload);
            })
            .then((fn) => {
                if (isActive) {
                    unlistenFn = fn;
                } else {
                    fn();
                }
            });

        // Suppress unhandled promise lint — we handle cleanup in the returned fn
        listenPromise.catch((err: unknown) => {
            this._tracer.error(`[EngineStatusService] Failed to listen to ${event}:`, err);
        });

        return () => {
            isActive = false;
            if (unlistenFn) unlistenFn();
        };
    }
}
