import { describe, expect, it, vi } from 'vitest';

import { destroyCoreResources } from './CoreComposition';

function destroyable(fn = vi.fn()) {
    return { destroy: fn };
}

describe('destroyCoreResources', () => {
    it('continues destroying remaining resources after one destroyer fails', async () => {
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {
            return;
        });
        const stateManagerDestroy = vi.fn(() => {
            throw new Error('state failed');
        });
        const eventHandlerDestroy = vi.fn();
        const errorHandlerDestroy = vi.fn();

        const args = {
            deferredChatInitTimer: 123 as unknown as ReturnType<typeof setTimeout>,
            stateManager: destroyable(stateManagerDestroy),
            eventHandler: destroyable(eventHandlerDestroy),
            chatController: destroyable(),
            appUI: destroyable(),
            settingsUI: destroyable(),
            moduleSettingsUI: destroyable(),
            downloadUI: destroyable(),
            navigationUI: destroyable(),
            windowUI: destroyable(),
            windowService: destroyable(),
            moduleService: destroyable(),
            i18nUI: destroyable(),
            consoleUI: destroyable(),
            monitoringUI: destroyable(),
            monitoringService: destroyable(),
            sidebarUI: destroyable(),
            particles: destroyable(),
            soundService: destroyable(),
            stateStore: destroyable(),
            aiBridge: destroyable(),
            bridge: destroyable(),
            errorHandler: destroyable(errorHandlerDestroy),
        } as unknown as Parameters<typeof destroyCoreResources>[0];

        try {
            await expect(destroyCoreResources(args)).rejects.toThrow(AggregateError);

            expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
            expect(eventHandlerDestroy).toHaveBeenCalledTimes(1);
            expect(errorHandlerDestroy).toHaveBeenCalledTimes(1);
        } finally {
            clearTimeoutSpy.mockRestore();
        }
    });
});
