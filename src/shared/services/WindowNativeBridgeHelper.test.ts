import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IBridge } from '@/shared/types/IBridge';
import { WindowNativeBridgeHelper } from './WindowNativeBridgeHelper';

describe('WindowNativeBridgeHelper', () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const bridge = { invoke } as unknown as IBridge;
    const runtime = {
        getWindowApi: vi.fn(),
    };
    const helper = new WindowNativeBridgeHelper(
        bridge,
        runtime as unknown as ConstructorParameters<typeof WindowNativeBridgeHelper>[1],
    );

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should set size, read maximize state and persist window state', async () => {
        const setSize = vi.fn().mockResolvedValue(undefined);
        const center = vi.fn().mockResolvedValue(undefined);
        const isMaximized = vi.fn().mockResolvedValue(false);
        const innerSize = vi.fn().mockResolvedValue({ width: 1280, height: 720 });
        const outerPosition = vi.fn().mockResolvedValue({ x: 10, y: 20 });
        const LogicalSize = vi.fn();

        runtime.getWindowApi.mockReturnValue({
            getCurrentWindow: () => ({
                setSize,
                center,
                isMaximized,
                innerSize,
                outerPosition,
            }),
            LogicalSize,
        });

        await helper.setSizeAndCenter(800, 600);
        expect(setSize).toHaveBeenCalled();
        expect(center).toHaveBeenCalled();

        expect(await helper.isMaximized()).toBe(false);

        await helper.saveWindowState();
        expect(invoke).toHaveBeenCalledWith('save_maximized_state', { maximized: false });
        expect(invoke).toHaveBeenCalledWith('save_window_size', { width: 1280, height: 720 });
        expect(invoke).toHaveBeenCalledWith('save_window_position', { x: 10, y: 20 });
    });

    it('should gracefully no-op when runtime window api is unavailable', async () => {
        runtime.getWindowApi.mockReturnValue(null);

        await expect(helper.setSizeAndCenter(800, 600)).resolves.toBeUndefined();
        await expect(helper.isMaximized()).resolves.toBe(false);
        await expect(helper.saveWindowState()).resolves.toBeUndefined();
    });
});
