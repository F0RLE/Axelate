/**
 * @module shared/services/StateManager
 * @description Centralized state persistence coordinator.
 * Replaces scattered beforeunload/visibilitychange/auto-save handlers
 * with a single coordinator that manages all persistence points.
 *
 * Responsibilities:
 * - Coordinates UI state saves (UiStateStore)
 * - Coordinates window state saves (WindowService)
 * - Single beforeunload handler — saves everything synchronously
 * - Single visibilitychange handler — saves everything async
 * - Provides unified save API for the rest of the app
 */

import type { LoggerService } from '@/infrastructure/logging/LoggerService';

type StateManagerLogger = Pick<LoggerService, 'debug' | 'info' | 'warn'>;

export interface StatePersistenceTarget {
    /** Human-readable name for logging */
    name: string;
    /** Async save — used for debounced/visibility saves */
    saveAsync: () => Promise<void>;
    /** Immediate save — used for explicit close/destroy and beforeunload best effort */
    saveImmediate: () => Promise<void> | void;
}

export class StateManager {
    private readonly _targets = new Map<string, StatePersistenceTarget>();
    private _isDestroyed = false;

    constructor(private readonly _tracer: StateManagerLogger) {}

    private readonly _boundVisibilityChange = () => {
        if (document.hidden) {
            void this.saveAllAsync();
        }
    };

    private readonly _boundBeforeUnload = () => {
        void this.saveAllImmediate();
    };

    /**
     * Register a persistence target. It will be included in saveAll* calls.
     */
    register(target: StatePersistenceTarget): void {
        if (this._isDestroyed) return;
        this._targets.set(target.name, target);
        this._tracer.debug(`[StateManager] Registered: ${target.name}`);
    }

    /**
     * Unregister a persistence target.
     */
    unregister(name: string): void {
        this._targets.delete(name);
    }

    /**
     * Save ALL registered targets asynchronously.
     * Called on visibilitychange (app going to background).
     */
    async saveAllAsync(): Promise<void> {
        if (this._isDestroyed) return;

        const targets = [...this._targets.values()];
        if (targets.length === 0) return;

        this._tracer.info(`[StateManager] Saving ${String(targets.length)} targets (async)...`);

        const results = await Promise.allSettled(
            targets.map(async (t) => {
                await t.saveAsync();
            }),
        );

        let successCount = 0;
        let failCount = 0;

        results.forEach((r, i) => {
            if (r.status === 'fulfilled') {
                successCount++;
            } else {
                failCount++;
                this._tracer.warn(
                    `[StateManager] Failed to save ${targets[i]?.name}: ${String(r.reason)}`,
                );
            }
        });

        this._tracer.info(
            `[StateManager] Save complete: ${String(successCount)} ok, ${String(failCount)} failed`,
        );
    }

    /**
     * Save ALL registered targets immediately.
     * Called on beforeunload as best effort and awaited by explicit shutdown paths.
     */
    async saveAllImmediate(): Promise<void> {
        if (this._isDestroyed) return;

        const targets = [...this._targets.values()];
        if (targets.length === 0) return;

        this._tracer.info(`[StateManager] Saving ${String(targets.length)} targets (immediate)...`);

        const results = await Promise.allSettled(
            targets.map(async (target) => {
                await target.saveImmediate();
            }),
        );

        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                this._tracer.warn(
                    `[StateManager] Immediate save failed for ${targets[index]?.name}: ${String(result.reason)}`,
                );
            }
        });
    }

    /**
     * Initialize global listeners (beforeunload, visibilitychange).
     * Call once during app bootstrap.
     */
    init(): void {
        document.addEventListener('visibilitychange', this._boundVisibilityChange);
        globalThis.addEventListener('beforeunload', this._boundBeforeUnload);
        this._tracer.debug('[StateManager] Global listeners registered');
    }

    /**
     * Clean up all listeners and targets.
     */
    async destroy(): Promise<void> {
        if (this._isDestroyed) return;

        // Final save before destroy
        await this.saveAllImmediate();
        this._isDestroyed = true;

        document.removeEventListener('visibilitychange', this._boundVisibilityChange);
        globalThis.removeEventListener('beforeunload', this._boundBeforeUnload);

        this._targets.clear();
        this._tracer.info('[StateManager] Destroyed');
    }
}
