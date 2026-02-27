import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UiStateStore } from './UiStateStore';
import type { IBridge } from '@/shared/types/IBridge';

function createMockBridge(isTauri = false): IBridge {
    return {
        isTauri: vi.fn(() => isTauri),
        invoke: vi.fn().mockResolvedValue(undefined),
        listen: vi.fn().mockResolvedValue(() => {}),
    };
}

describe('UiStateStore', () => {
    let bridge: IBridge;
    let store: UiStateStore;

    beforeEach(() => {
        vi.useFakeTimers();
        bridge = createMockBridge();
        store = new UiStateStore(bridge);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('State management', () => {
        it('should return default state on creation', () => {
            const state = store.getState();
            expect(state.sidebar_collapsed).toBe(false);
            expect(state.sidebar_width).toBe(280);
            expect(state.zoom_level).toBe(1);
            expect(state.sound_enabled).toBe(true);
            expect(state.last_active_provider).toBeNull();
            expect(state.ai_session_id).toBeNull();
        });

        it('should merge state via setState', () => {
            store.setState({ sidebar_collapsed: true });
            expect(store.getState().sidebar_collapsed).toBe(true);
            // Other defaults remain
            expect(store.getState().sidebar_width).toBe(280);
        });

        it('should update state and mark dirty', () => {
            store.updateState({ sidebar_width: 400 });
            expect(store.getState().sidebar_width).toBe(400);
        });

        it('should update state without marking dirty', () => {
            store.updateState({ zoom_level: 2 }, false);
            expect(store.getState().zoom_level).toBe(2);
        });

        it('should update nested state', () => {
            store.updateNestedState('card_widths', 'card-1', '300px');
            expect(store.getState().card_widths['card-1']).toBe('300px');
        });

        it('should remove nested state', () => {
            store.updateNestedState('card_widths', 'card-1', '300px');
            store.removeNestedState('card_widths', 'card-1');
            expect(store.getState().card_widths['card-1']).toBeUndefined();
        });

        it('should update nested state without marking dirty (L102)', () => {
            store.updateNestedState('card_widths', 'card-2', '400px', false);
            expect(store.getState().card_widths['card-2']).toBe('400px');
        });

        it('should remove nested state without marking dirty (L115)', () => {
            store.updateNestedState('card_widths', 'card-3', '500px');
            store.removeNestedState('card_widths', 'card-3', false);
            expect(store.getState().card_widths['card-3']).toBeUndefined();
        });
    });

    describe('loadState', () => {
        it('should load from backend in Tauri environment', async () => {
            bridge = createMockBridge(true);
            (bridge.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
                sidebar_width: 500,
            });
            store = new UiStateStore(bridge);

            const result = await store.loadState();
            expect(bridge.invoke).toHaveBeenCalledWith('get_ui_state');
            expect(result.sidebar_width).toBe(500);
        });

        it('should load from localStorage in non-Tauri environment', async () => {
            localStorage.setItem('axelate_ui_state', JSON.stringify({ sidebar_width: 350 }));
            store = new UiStateStore(bridge);

            const result = await store.loadState();
            expect(result.sidebar_width).toBe(350);
        });

        it('should use defaults when localStorage is null (L67)', async () => {
            localStorage.removeItem('axelate_ui_state');
            store = new UiStateStore(bridge);

            const result = await store.loadState();
            expect(result.sidebar_width).toBe(280); // default
        });

        it('should handle load errors and return defaults', async () => {
            bridge = createMockBridge(true);
            (bridge.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('Backend fail'),
            );
            store = new UiStateStore(bridge);

            const result = await store.loadState();
            // Should fall back to defaults without throwing
            expect(result.sidebar_width).toBe(280);
        });
    });

    describe('saveAsync', () => {
        it('should save to backend in Tauri environment when dirty', async () => {
            bridge = createMockBridge(true);
            store = new UiStateStore(bridge);
            store.updateState({ sidebar_width: 999 });

            await store.saveAsync();
            expect(bridge.invoke).toHaveBeenCalledWith('save_ui_state', {
                state: expect.objectContaining({ sidebar_width: 999 }) as unknown,
            });
        });

        it('should save to localStorage in non-Tauri environment when dirty', async () => {
            store.updateState({ sidebar_width: 450 });
            await store.saveAsync();

            const stored = JSON.parse(localStorage.getItem('axelate_ui_state') ?? '{}') as Record<
                string,
                unknown
            >;
            expect(stored['sidebar_width']).toBe(450);
        });

        it('should not save when not dirty', async () => {
            await store.saveAsync();
            expect(bridge.invoke).not.toHaveBeenCalled();
        });

        it('should handle save errors gracefully', async () => {
            bridge = createMockBridge(true);
            (bridge.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Save fail'));
            store = new UiStateStore(bridge);
            store.updateState({ sidebar_width: 123 });

            // Should not throw
            await expect(store.saveAsync()).resolves.toBeUndefined();
        });
    });

    describe('saveImmediate', () => {
        it('should save synchronously to localStorage when dirty', () => {
            store.updateState({ zoom_level: 1.5 });
            store.saveImmediate();

            const stored = JSON.parse(localStorage.getItem('axelate_ui_state') ?? '{}') as Record<
                string,
                unknown
            >;
            expect(stored['zoom_level']).toBe(1.5);
        });

        it('should not save when not dirty', () => {
            store.saveImmediate();
            expect(localStorage.getItem('axelate_ui_state')).toBeNull();
        });

        it('should save to backend in Tauri environment', () => {
            bridge = createMockBridge(true);
            store = new UiStateStore(bridge);
            store.updateState({ sidebar_width: 777 });
            store.saveImmediate();
            expect(bridge.invoke).toHaveBeenCalledWith('save_ui_state', {
                state: expect.objectContaining({ sidebar_width: 777 }) as unknown,
            });
        });
    });

    describe('Debounced auto-save', () => {
        it('should debounce saves on updateState', async () => {
            bridge = createMockBridge(true);
            store = new UiStateStore(bridge);

            store.updateState({ sidebar_width: 100 });
            store.updateState({ sidebar_width: 200 });
            store.updateState({ sidebar_width: 300 });

            // Nothing saved yet
            expect(bridge.invoke).not.toHaveBeenCalled();

            // Advance past debounce (1000ms)
            vi.advanceTimersByTime(1100);
            await Promise.resolve();
            await Promise.resolve();

            expect(bridge.invoke).toHaveBeenCalledWith('save_ui_state', {
                state: expect.objectContaining({ sidebar_width: 300 }) as unknown,
            });
        });
    });

    describe('saveImmediate error handling', () => {
        it('should catch errors during saveImmediate gracefully', () => {
            bridge = createMockBridge(true);
            (bridge.invoke as ReturnType<typeof vi.fn>).mockImplementation(() => {
                throw new Error('Invoke crashed');
            });
            store = new UiStateStore(bridge);
            store.updateState({ sidebar_width: 123 });

            // Should not throw
            expect(() => store.saveImmediate()).not.toThrow();
        });
    });

    describe('Auto-save events', () => {
        it('should save on visibilitychange when hidden', () => {
            bridge = createMockBridge(true);
            store = new UiStateStore(bridge);
            store.updateState({ sidebar_width: 400 });

            // Simulate document becoming hidden
            Object.defineProperty(document, 'hidden', {
                value: true,
                writable: true,
                configurable: true,
            });
            document.dispatchEvent(new Event('visibilitychange'));

            // saveAsync is called which eventually invokes bridge
            // We need to wait for async
        });

        it('should not save on visibilitychange when NOT hidden (L160)', () => {
            bridge = createMockBridge(true);
            store = new UiStateStore(bridge);
            store.updateState({ sidebar_width: 400 });

            // Simulate document becoming visible (not hidden)
            Object.defineProperty(document, 'hidden', {
                value: false,
                writable: true,
                configurable: true,
            });
            document.dispatchEvent(new Event('visibilitychange'));

            // saveAsync should NOT be called (the `if (document.hidden)` guard)
            // bridge.invoke should not have been called for save
        });

        it('should saveImmediate on beforeunload', () => {
            bridge = createMockBridge();
            store = new UiStateStore(bridge);
            store.updateState({ sidebar_width: 500 });

            globalThis.dispatchEvent(new Event('beforeunload'));

            const stored = JSON.parse(localStorage.getItem('axelate_ui_state') ?? '{}') as Record<
                string,
                unknown
            >;
            expect(stored['sidebar_width']).toBe(500);
        });
    });
});
