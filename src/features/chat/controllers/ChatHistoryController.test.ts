import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatHistoryController } from './ChatHistoryController';
import type { IChatMessage } from '../types/chatTypes';

type MutableState = {
    history: IChatMessage[];
    sessionId: string;
};

function createController(stateOverrides?: Partial<MutableState>) {
    const state: MutableState = {
        history: [],
        sessionId: 'session-1',
        ...stateOverrides,
    };

    const aiBridge = {
        getSessionId: vi.fn(() => state.sessionId),
        getHistory: vi.fn(() => Promise.resolve(state.history)),
        rewindLastTurn: vi.fn(),
    };

    const deps = {
        aiBridge: aiBridge as never,
        getHistory: vi.fn(() => state.history),
        setHistory: vi.fn((history: IChatMessage[]) => {
            state.history = history;
        }),
        revealLatestMessage: vi.fn(),
        restoreInputText: vi.fn(),
        renderHistory: vi.fn(),
        showEditError: vi.fn(),
        isDestroyed: vi.fn(() => false),
        getPendingChatRevealStore: vi.fn(() => null),
        tracer: {
            debug: vi.fn(),
            error: vi.fn(),
        },
    };

    return {
        controller: new ChatHistoryController(deps),
        deps,
        aiBridge,
        state,
    };
}

describe('ChatHistoryController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should reload history when session id changes', async () => {
        const firstHistory: IChatMessage[] = [{ role: 'user', content: 'first' }];
        const secondHistory: IChatMessage[] = [{ role: 'assistant', content: 'second' }];
        const { controller, deps, aiBridge, state } = createController({
            history: firstHistory,
        });

        await controller.ensureHistoryLoaded();
        expect(aiBridge.getHistory).toHaveBeenCalledTimes(1);
        expect(deps.renderHistory).toHaveBeenLastCalledWith(firstHistory);

        state.sessionId = 'session-2';
        state.history = secondHistory;

        await controller.ensureHistoryLoaded();

        expect(aiBridge.getHistory).toHaveBeenCalledTimes(2);
        expect(deps.setHistory).toHaveBeenLastCalledWith(secondHistory);
        expect(deps.renderHistory).toHaveBeenLastCalledWith(secondHistory);
    });

    it('should load the new session when session id changes during an in-flight restore', async () => {
        const firstHistory: IChatMessage[] = [{ role: 'user', content: 'first' }];
        const secondHistory: IChatMessage[] = [{ role: 'assistant', content: 'second' }];
        let resolveFirstLoad: (history: IChatMessage[]) => void = () => {};
        const { controller, deps, aiBridge, state } = createController({
            history: firstHistory,
        });
        aiBridge.getHistory
            .mockImplementationOnce(
                () =>
                    new Promise<IChatMessage[]>((resolve) => {
                        resolveFirstLoad = resolve;
                    }),
            )
            .mockImplementationOnce(() => Promise.resolve(secondHistory));

        const firstLoad = controller.ensureHistoryLoaded();
        state.sessionId = 'session-2';
        const secondLoad = controller.ensureHistoryLoaded();
        resolveFirstLoad(firstHistory);
        await Promise.all([firstLoad, secondLoad]);

        expect(aiBridge.getHistory).toHaveBeenCalledTimes(2);
        expect(deps.setHistory).toHaveBeenLastCalledWith(secondHistory);
        expect(deps.renderHistory).toHaveBeenLastCalledWith(secondHistory);
    });

    it('should clear rendered chat when the current session has no persisted history', async () => {
        const { controller, deps, state } = createController({
            history: [{ role: 'user', content: 'stale' }],
        });

        await controller.ensureHistoryLoaded();
        expect(deps.renderHistory).toHaveBeenLastCalledWith([{ role: 'user', content: 'stale' }]);

        state.sessionId = 'session-empty';
        state.history = [];

        await controller.ensureHistoryLoaded();

        expect(deps.setHistory).toHaveBeenLastCalledWith([]);
        expect(deps.renderHistory).toHaveBeenLastCalledWith([]);
    });

    it('should load persisted history for the default session id', async () => {
        const defaultHistory: IChatMessage[] = [{ role: 'user', content: 'persisted-default' }];
        const { controller, deps, aiBridge } = createController({
            sessionId: 'default',
            history: defaultHistory,
        });

        await controller.ensureHistoryLoaded();

        expect(aiBridge.getHistory).toHaveBeenCalledTimes(1);
        expect(deps.setHistory).toHaveBeenLastCalledWith(defaultHistory);
        expect(deps.renderHistory).toHaveBeenLastCalledWith(defaultHistory);
    });

    it('should rewind the last turn and return text for regeneration', async () => {
        const { controller, deps, aiBridge } = createController({
            history: [
                { role: 'user', content: 'first' },
                { role: 'assistant', content: 'first answer' },
                { role: 'user', content: 'again' },
                { role: 'assistant', content: 'again answer' },
            ],
        });
        aiBridge.rewindLastTurn.mockResolvedValueOnce('again');

        const text = await controller.regenerateLastTurn(false);

        expect(text).toBe('again');
        expect(deps.setHistory).toHaveBeenLastCalledWith([
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'first answer' },
        ]);
        expect(deps.renderHistory).toHaveBeenLastCalledWith([
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'first answer' },
        ]);
    });
});
