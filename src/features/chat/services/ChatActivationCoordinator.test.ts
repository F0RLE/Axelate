import { describe, expect, it, vi } from 'vitest';

import { ChatActivationCoordinator } from './ChatActivationCoordinator';

describe('ChatActivationCoordinator', () => {
    it('should stop a stale active provider when no AI card is selected', async () => {
        const stopProvider = vi.fn();
        const scheduleInactiveAiError = vi.fn();

        const coordinator = new ChatActivationCoordinator({
            aiBridge: {
                isActive: () => true,
                getState: () => ({
                    activeProviderId: 'gpt-image',
                    isRunning: true,
                }),
                stopProvider,
            } as never,
            uiStateHelper: {
                clearInactiveAiErrorTimeout: vi.fn(),
                scheduleInactiveAiError,
            } as never,
            getSelectedProviderId: () => null,
            tryAutoStartAi: vi.fn().mockResolvedValue(false),
            tracer: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
            },
        });

        const result = await coordinator.ensureActive(null);

        expect(result).toBe(false);
        expect(stopProvider).toHaveBeenCalledTimes(1);
        expect(scheduleInactiveAiError).toHaveBeenCalledTimes(1);
    });

    it('should restart the selected provider when the active one diverges from the selected card', async () => {
        const stopProvider = vi.fn();
        const clearInactiveAiErrorTimeout = vi.fn();
        const tryAutoStartAi = vi.fn().mockResolvedValue(true);

        const coordinator = new ChatActivationCoordinator({
            aiBridge: {
                isActive: () => true,
                getState: () => ({
                    activeProviderId: 'gpt-image',
                    isRunning: true,
                }),
                stopProvider,
            } as never,
            uiStateHelper: {
                clearInactiveAiErrorTimeout,
                scheduleInactiveAiError: vi.fn(),
            } as never,
            getSelectedProviderId: () => 'gpt',
            tryAutoStartAi,
            tracer: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
            },
        });

        const result = await coordinator.ensureActive(null);

        expect(result).toBe(true);
        expect(stopProvider).toHaveBeenCalledTimes(1);
        expect(tryAutoStartAi).toHaveBeenCalledTimes(1);
        expect(clearInactiveAiErrorTimeout).toHaveBeenCalledTimes(1);
    });
});
