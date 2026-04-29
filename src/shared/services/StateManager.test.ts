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

    it('should not save targets registered after destroy', async () => {
        const manager = new StateManager(tracer);
        await manager.destroy();
        const target = createTarget();

        manager.register(target);
        await manager.saveAllImmediate();

        expect(target.saveImmediate).not.toHaveBeenCalled();
    });
});
