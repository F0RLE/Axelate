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

import { tracer } from '@/infrastructure/logging/LoggerService';

export interface StatePersistenceTarget {
    /** Human-readable name for logging */
    name: string;
    /** Async save — used for debounced/visibility saves */
    saveAsync: () => Promise<void>;
    /** Sync save — used for beforeunload (fire-and-forget ok) */
    saveImmediate: () => void;
}

export class StateManager {
    private readonly _targets = new Map<string, StatePersistenceTarget>();
    private _isDestroyed = false;

    private readonly _boundVisibilityChange = () => {
        if (document.hidden) {
            void this.saveAllAsync();
        }
    };

    private readonly _boundBeforeUnload = () => {
        this.saveAllImmediate();
    };

    /**
     * Register a persistence target. It will be included in saveAll* calls.
     */
    register(target: StatePersistenceTarget): void {
        if (this._isDestroyed) return;
        this._targets.set(target.name, target);
        tracer.info(`[StateManager] Registered: ${target.name}`);
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

        tracer.info(`[StateManager] Saving ${String(targets.length)} targets (async)...`);

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
                tracer.warn(
                    `[StateManager] Failed to save ${targets[i]?.name}: ${String(r.reason)}`,
                );
            }
        });

        tracer.info(
            `[StateManager] Save complete: ${String(successCount)} ok, ${String(failCount)} failed`,
        );
    }

    /**
     * Save ALL registered targets immediately (fire-and-forget).
     * Called on beforeunload — no await, best effort.
     */
    saveAllImmediate(): void {
        if (this._isDestroyed) return;

        const targets = [...this._targets.values()];
        if (targets.length === 0) return;

        tracer.info(`[StateManager] Saving ${String(targets.length)} targets (immediate)...`);

        // Fire all saves — no await, best effort before page unloads
        for (const target of targets) {
            try {
                target.saveImmediate();
            } catch (e) {
                tracer.warn(
                    `[StateManager] Immediate save failed for ${target.name}: ${String(e)}`,
                );
            }
        }
    }

    /**
     * Initialize global listeners (beforeunload, visibilitychange).
     * Call once during app bootstrap.
     */
    init(): void {
        document.addEventListener('visibilitychange', this._boundVisibilityChange);
        globalThis.addEventListener('beforeunload', this._boundBeforeUnload);
        tracer.info('[StateManager] Global listeners registered');
    }

    /**
     * Clean up all listeners and targets.
     */
    destroy(): void {
        if (this._isDestroyed) return;
        this._isDestroyed = true;

        // Final save before destroy
        this.saveAllImmediate();

        document.removeEventListener('visibilitychange', this._boundVisibilityChange);
        globalThis.removeEventListener('beforeunload', this._boundBeforeUnload);

        this._targets.clear();
        tracer.info('[StateManager] Destroyed');
    }
}
