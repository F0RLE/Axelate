import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IBridge } from '@/shared/types/IBridge';
import { WindowNativeBridgeHelper } from './WindowNativeBridgeHelper';

describe('WindowNativeBridgeHelper', () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const isTauri = vi.fn().mockReturnValue(true);
    const bridge = { invoke, isTauri } as unknown as IBridge;
    const runtime = {
        getCurrentWindow: vi.fn(),
        createLogicalSize: vi.fn((width: number, height: number) => ({ width, height })),
    };
    const helper = new WindowNativeBridgeHelper(
        bridge,
        runtime as unknown as ConstructorParameters<typeof WindowNativeBridgeHelper>[1],
    );

    beforeEach(() => {
        vi.clearAllMocks();
        isTauri.mockReturnValue(true);
    });

    it('should set size, read maximize state and persist window state', async () => {
        const setSize = vi.fn().mockResolvedValue(undefined);
        const center = vi.fn().mockResolvedValue(undefined);
        const isMaximized = vi.fn().mockResolvedValue(false);
        const innerSize = vi.fn().mockResolvedValue({ width: 1280, height: 720 });
        const outerPosition = vi.fn().mockResolvedValue({ x: 10, y: 20 });
        runtime.getCurrentWindow.mockReturnValue({
            setSize,
            center,
            isMaximized,
            innerSize,
            outerPosition,
        });

        await helper.setSizeAndCenter(800, 600);
        expect(setSize).toHaveBeenCalledWith({ width: 800, height: 600 });
        expect(center).toHaveBeenCalled();

        expect(await helper.isMaximized()).toBe(false);

        await helper.saveWindowState();
        expect(invoke).toHaveBeenCalledWith('save_maximized_state', { maximized: false });
        expect(invoke).toHaveBeenCalledWith('save_window_size', { width: 1280, height: 720 });
        expect(invoke).toHaveBeenCalledWith('save_window_position', { x: 10, y: 20 });
    });

    it('should gracefully no-op when runtime window api is unavailable', async () => {
        isTauri.mockReturnValue(false);

        await expect(helper.setSizeAndCenter(800, 600)).resolves.toBeUndefined();
        await expect(helper.isMaximized()).resolves.toBe(false);
        await expect(helper.saveWindowState()).resolves.toBeUndefined();
    });
});
