import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { EngineStatusContext } from './AIBridgeContext';
import { escapeCssSelectorValue } from '@/shared/utils/cssSelectors';

type EngineStatusLogger = Pick<LoggerService, 'debug' | 'info' | 'error'>;

type EngineState = 'idle' | 'starting' | 'swapping' | 'ready' | 'error';
type BackendEngineState =
    | 'idle'
    | { starting: { engine_id: string } }
    | { swapping: { from: string; to: string } }
    | { ready: { slots: Array<{ engine: BackendEngineStatus }> } }
    | { error: EngineErrorPayload };
type BackendEngineStatus = {
    id: string;
    endpoint: string;
    healthy: boolean;
};

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
    private _domObserver: MutationObserver | null = null;
    private _domSyncFrame: number | null = null;
    private _refreshGeneration = 0;
    private _initialized = false;

    public constructor(private readonly _tracer: EngineStatusLogger) {}

    /** engine_id → endpoint for all currently-ready engines */
    private readonly _activeSlots = new Map<string, string>();

    public setContext(context: EngineStatusContext): void {
        this._context = context;
    }

    public init(): void {
        if (this._initialized) {
            return;
        }
        if (this._context?.tauriProvider.isTauri() !== true) return;

        this._refreshGeneration += 1;
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

        this._tracer.debug('[EngineStatusService] Listening for engine events');
        this._initialized = true;
        this._startDomSyncObserver();
        void this.refreshFromBackend();
    }

    public destroy(): void {
        this._refreshGeneration += 1;
        this._unlisteners.forEach((fn) => fn());
        this._unlisteners.length = 0;
        this._domObserver?.disconnect();
        this._domObserver = null;
        this._cancelDomSyncFrame();
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

    public async refreshFromBackend(): Promise<void> {
        if (this._context?.tauriProvider.isTauri() !== true) {
            return;
        }

        const refreshGeneration = this._refreshGeneration;
        try {
            const state =
                await this._context.tauriProvider.invoke<BackendEngineState>('get_engine_state');
            if (refreshGeneration !== this._refreshGeneration) {
                return;
            }
            this._applyBackendState(state);
        } catch (error) {
            if (refreshGeneration !== this._refreshGeneration) {
                return;
            }
            this._tracer.error('[EngineStatusService] Failed to refresh engine state:', error);
        }
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
        const escapedEngineId = escapeCssSelectorValue(engineId);
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
        const escapedEngineId = escapeCssSelectorValue(engineId);
        const cards = document.querySelectorAll<HTMLElement>(
            `[data-current-module="${escapedEngineId}"]`,
        );

        cards.forEach((card) => {
            const isRunning = state === 'ready';
            this._resetCardClasses(card);
            card.classList.add(`engine-${state}`);
            card.dataset['runtimeStatus'] = isRunning ? 'running' : state;
            card.classList.toggle('module-running', isRunning);
            card.classList.toggle('module-stopped', !isRunning);
        });
    }

    private _startDomSyncObserver(): void {
        this._domObserver?.disconnect();
        this._cancelDomSyncFrame();

        this._domObserver = new MutationObserver((records) => {
            if (this._retargetDomSyncObserver(records)) {
                this._scheduleDomSync();
                return;
            }

            if (this._hasRelevantDomSyncMutation(records)) {
                this._scheduleDomSync();
            }
        });
        const observeOptions: MutationObserverInit = {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-app-id', 'data-current-module'],
        };
        const target = this._getDomSyncTarget();
        this._domObserver.observe(target, observeOptions);
    }

    private _getDomSyncTarget(): HTMLElement {
        return (
            document.querySelector<HTMLElement>('.models-grid') ??
            document.querySelector<HTMLElement>('#page-modules') ??
            document.body
        );
    }

    private _retargetDomSyncObserver(records: MutationRecord[]): boolean {
        const preferredTarget =
            document.querySelector<HTMLElement>('.models-grid') ??
            document.querySelector<HTMLElement>('#page-modules');
        if (
            preferredTarget === null ||
            records.every((record) => record.target === preferredTarget)
        ) {
            return false;
        }

        const appearedInMutation = records.some((record) =>
            Array.from(record.addedNodes).some((node) =>
                this._nodeMatchesDomSyncTarget(node, '.models-grid, #page-modules'),
            ),
        );
        if (!appearedInMutation) {
            return false;
        }

        this._domObserver?.disconnect();
        this._domObserver?.observe(preferredTarget, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-app-id', 'data-current-module'],
        });
        return true;
    }

    private _hasRelevantDomSyncMutation(records: MutationRecord[]): boolean {
        return records.some((record) => {
            if (
                record.type === 'attributes' &&
                record.target instanceof Element &&
                this._elementMatchesEngineCard(record.target)
            ) {
                return true;
            }

            return Array.from(record.addedNodes).some((node) =>
                this._nodeMatchesDomSyncTarget(node, '[data-app-id], [data-current-module]'),
            );
        });
    }

    private _nodeMatchesDomSyncTarget(node: Node, selector: string): boolean {
        if (!(node instanceof Element)) {
            return false;
        }

        return node.matches(selector) || node.querySelector(selector) !== null;
    }

    private _elementMatchesEngineCard(element: Element): boolean {
        return element.hasAttribute('data-app-id') || element.hasAttribute('data-current-module');
    }

    private _applyActiveStatesToDom(): void {
        this._activeSlots.forEach((_endpoint, engineId) => {
            this._setCardState(engineId, 'ready');
            this._setDashboardCardState(engineId, 'ready');
        });
    }

    private _scheduleDomSync(): void {
        if (this._domSyncFrame !== null) {
            return;
        }

        this._domSyncFrame = globalThis.requestAnimationFrame(() => {
            this._domSyncFrame = null;
            this._applyActiveStatesToDom();
        });
    }

    private _cancelDomSyncFrame(): void {
        if (this._domSyncFrame === null) {
            return;
        }

        globalThis.cancelAnimationFrame(this._domSyncFrame);
        this._domSyncFrame = null;
    }

    private _applyBackendState(state: BackendEngineState): void {
        if (state === 'idle') {
            this._clearActiveEngineStates();
            return;
        }

        if ('ready' in state) {
            this._syncReadySlots(state.ready.slots);
            return;
        }

        if ('starting' in state) {
            this.setEngineState(state.starting.engine_id, 'starting');
            return;
        }

        if ('swapping' in state) {
            this.setEngineState(state.swapping.from, 'idle');
            this.setEngineState(state.swapping.to, 'swapping');
            return;
        }

        if ('error' in state) {
            this.setEngineState(state.error.engine_id, 'error');
        }
    }

    private _syncReadySlots(slots: Array<{ engine: BackendEngineStatus }>): void {
        const previousActive = new Set(this._activeSlots.keys());
        this._activeSlots.clear();

        slots.forEach((slot) => {
            if (!slot.engine.healthy) {
                previousActive.delete(slot.engine.id);
                this.setEngineState(slot.engine.id, 'error');
                return;
            }
            this._activeSlots.set(slot.engine.id, slot.engine.endpoint);
            previousActive.delete(slot.engine.id);
            this.setEngineState(slot.engine.id, 'ready');
        });

        previousActive.forEach((engineId) => {
            this.setEngineState(engineId, 'idle');
        });
    }

    private _clearActiveEngineStates(): void {
        const activeIds = Array.from(this._activeSlots.keys());
        this._activeSlots.clear();
        activeIds.forEach((engineId) => {
            this.setEngineState(engineId, 'idle');
        });
        document
            .querySelectorAll<HTMLElement>(
                [
                    '[data-app-id]',
                    '[data-current-module]',
                    '.engine-idle',
                    '.engine-starting',
                    '.engine-swapping',
                    '.engine-ready',
                    '.engine-error',
                ].join(', '),
            )
            .forEach((card) => {
                if (!this._isEngineBoundCard(card)) {
                    return;
                }

                this._resetCardClasses(card);
                card.classList.add('engine-idle');
                card.classList.remove('module-running');
                if (card.dataset['currentModule'] !== undefined) {
                    card.classList.add('module-stopped');
                    card.dataset['runtimeStatus'] = 'idle';
                }
            });
    }

    private _isEngineBoundCard(card: HTMLElement): boolean {
        return card.dataset['appId'] !== undefined || card.dataset['currentModule'] !== undefined;
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
            btn.textContent = this._translate('ui.launcher.modules.modal.btn_remove', 'Remove');
        } else {
            btn.classList.remove('active-module-btn', 'stop-btn');
            btn.textContent = this._translate('ui.launcher.modules.modal.btn_remove', 'Remove');
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
