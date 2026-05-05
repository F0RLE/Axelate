import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StateManager, type StatePersistenceTarget } from './StateManager';

function createTarget(name = 'target'): StatePersistenceTarget {
    return {
        name,
        saveAsync: vi.fn().mockResolvedValue(undefined),
        saveImmediate: vi.fn().mockResolvedValue(undefined),
    };
}

describe('StateManager', () => {
    const tracer = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
    });

    it('registers, unregisters, and skips empty saves', async () => {
        const manager = new StateManager(tracer);
        const target = createTarget('cache');

        await manager.saveAllAsync();
        await manager.saveAllImmediate();
        manager.register(target);
        manager.unregister('cache');
        await manager.saveAllAsync();
        await manager.saveAllImmediate();

        expect(target.saveAsync).not.toHaveBeenCalled();
        expect(target.saveImmediate).not.toHaveBeenCalled();
        expect(tracer.debug).toHaveBeenCalledWith('[StateManager] Registered: cache');
    });

    it('saves all async targets and logs failures', async () => {
        const manager = new StateManager(tracer);
        const ok = createTarget('ok');
        const failing = createTarget('failing');
        vi.mocked(failing.saveAsync).mockRejectedValueOnce(new Error('disk full'));
        manager.register(ok);
        manager.register(failing);

        await manager.saveAllAsync();

        expect(ok.saveAsync).toHaveBeenCalledOnce();
        expect(failing.saveAsync).toHaveBeenCalledOnce();
        expect(tracer.warn).toHaveBeenCalledWith(
            '[StateManager] Failed to save failing: Error: disk full',
        );
        expect(tracer.info).toHaveBeenCalledWith('[StateManager] Save complete: 1 ok, 1 failed');
    });

    it('should flush registered targets before destroy disables saving', async () => {
        const manager = new StateManager(tracer);
        const target = createTarget();
        manager.register(target);

        await manager.destroy();

        expect(target.saveImmediate).toHaveBeenCalledTimes(1);
    });

    it('should await immediate saves', async () => {
        const manager = new StateManager(tracer);
        let settled = false;
        let release!: () => void;
        const target: StatePersistenceTarget = {
            name: 'slow-target',
            saveAsync: vi.fn().mockResolvedValue(undefined),
            saveImmediate: vi.fn(
                () =>
                    new Promise<void>((resolve) => {
                        release = () => {
                            settled = true;
                            resolve();
                        };
                    }),
            ),
        };
        manager.register(target);

        const save = manager.saveAllImmediate();
        await Promise.resolve();

        expect(settled).toBe(false);
        release();
        await save;
        expect(settled).toBe(true);
    });

    it('logs immediate save failures without rejecting', async () => {
        const manager = new StateManager(tracer);
        const target = createTarget('window');
        vi.mocked(target.saveImmediate).mockRejectedValueOnce('locked');
        manager.register(target);

        await expect(manager.saveAllImmediate()).resolves.toBeUndefined();

        expect(tracer.warn).toHaveBeenCalledWith(
            '[StateManager] Immediate save failed for window: locked',
        );
    });

    it('saves on visibility hidden and beforeunload', async () => {
        const manager = new StateManager(tracer);
        const target = createTarget();
        manager.register(target);
        manager.init();

        Object.defineProperty(document, 'hidden', {
            configurable: true,
            value: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
        await Promise.resolve();
        globalThis.dispatchEvent(new Event('beforeunload'));
        await Promise.resolve();
        await Promise.resolve();

        expect(target.saveAsync).toHaveBeenCalledOnce();
        expect(target.saveImmediate).toHaveBeenCalledOnce();

        await manager.destroy();
    });

    it('does not save on visibility visible and removes listeners on destroy', async () => {
        const manager = new StateManager(tracer);
        const target = createTarget();
        manager.register(target);
        manager.init();

        Object.defineProperty(document, 'hidden', {
            configurable: true,
            value: false,
        });
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
        await manager.destroy();
        globalThis.dispatchEvent(new Event('beforeunload'));
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();

        expect(target.saveAsync).not.toHaveBeenCalled();
        expect(target.saveImmediate).toHaveBeenCalledOnce();
        await expect(manager.destroy()).resolves.toBeUndefined();
    });

    it('should not save targets registered after destroy', async () => {
        const manager = new StateManager(tracer);
        await manager.destroy();
        const target = createTarget();

        manager.register(target);
        await manager.saveAllAsync();
        await manager.saveAllImmediate();

        expect(target.saveAsync).not.toHaveBeenCalled();
        expect(target.saveImmediate).not.toHaveBeenCalled();
    });
});
