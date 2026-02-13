import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Deep mock of Tauri API
const mockInvoke = vi.fn().mockResolvedValue(undefined);

const tauriMock = {
    core: { invoke: mockInvoke },
    event: {
        listen: vi.fn().mockResolvedValue(() => {
            /* no-op */
        }),
    },
};

// Set before import
(globalThis as Record<string, unknown>)['__TAURI__'] = tauriMock;

// Mock localStorage
const storageMock = new Map<string, string>();
const localStorageMock = {
    getItem: vi.fn((key: string) => storageMock.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
        storageMock.set(key, value);
    }),
    removeItem: vi.fn((key: string) => storageMock.delete(key)),
    clear: vi.fn(() => {
        storageMock.clear();
    }),
    key: vi.fn(),
    length: 0,
};
vi.stubGlobal('localStorage', localStorageMock);

// Mock Core dependency
const mockCore = {
    tauriProvider: {
        invoke: mockInvoke,
        isTauri: vi.fn().mockReturnValue(true),
    },
};

import { StateService } from '@/shared/services/StateService';

describe('StateService', () => {
    let stateService: StateService;

    beforeEach(() => {
        vi.clearAllMocks();
        storageMock.clear();
        vi.useFakeTimers();
        (globalThis as Record<string, unknown>)['__TAURI__'] = tauriMock;
        stateService = new StateService(mockCore.tauriProvider as any);
    });

    afterEach(() => {
        vi.useRealTimers();
        (globalThis as unknown as Record<string, unknown>)['__TAURI__'] = tauriMock;
        (globalThis as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {
            invoke: async () => {
                await Promise.resolve();
            },
            transformCallback: () => 0,
        };
        (mockCore.tauriProvider.isTauri as unknown as Mock).mockReturnValue(true);
    });

    describe('loadState', () => {
        it('should load state from backend when Tauri is available', async () => {
            const mockState = {
                sidebar_collapsed: true,
                sidebar_width: 300,
                hidden_nav_items: ['debug'],
                hidden_monitors: [],
                card_widths: {},
                download_limit_enabled: false,
                download_max_speed: 50,
                selected_modules: {},
            };

            mockInvoke.mockResolvedValueOnce(mockState);

            const state = await stateService.loadState();

            expect(mockInvoke).toHaveBeenCalledWith('get_ui_state');
            expect(state.sidebar_collapsed).toBe(true);
            expect(state.sidebar_width).toBe(300);
        });

        it('should fallback to localStorage when Tauri is missing', async () => {
            delete (globalThis as Record<string, unknown>)['__TAURI__'];
            delete (globalThis as Record<string, unknown>)['__TAURI_INTERNALS__'];
            (mockCore.tauriProvider.isTauri as unknown as Mock).mockReturnValue(false);

            const fallbackState = {
                sidebar_collapsed: true,
                sidebar_width: 350,
            };
            storageMock.set('axelate_ui_state', JSON.stringify(fallbackState));

            const state = await stateService.loadState();

            expect(state.sidebar_collapsed).toBe(true);
            expect(state.sidebar_width).toBe(350);

            // Restore
            (globalThis as Record<string, unknown>)['__TAURI__'] = tauriMock;
            (globalThis as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {
                invoke: async () => {
                    await Promise.resolve();
                },
                transformCallback: () => 0,
            };
            (mockCore.tauriProvider.isTauri as unknown as Mock).mockReturnValue(true);
        });

        it('should return default state when backend fails', async () => {
            mockInvoke.mockRejectedValueOnce(new Error('Backend error'));

            const state = await stateService.loadState();

            // Should return defaults
            expect(state.sidebar_collapsed).toBe(false);
            expect(state.sidebar_width).toBe(280);
        });
    });

    describe('get/set', () => {
        it('should get state values', () => {
            expect(stateService.get('sidebar_collapsed')).toBe(false);
            expect(stateService.get('sidebar_width')).toBe(280);
        });

        it('should set state values', () => {
            stateService.set('sidebar_collapsed', true);
            expect(stateService.get('sidebar_collapsed')).toBe(true);
        });

        it('should mark state as dirty when set is called', () => {
            stateService.set('sidebar_width', 350);
            expect(stateService.get('sidebar_width')).toBe(350);
        });
    });

    describe('getState', () => {
        it('should return full state object', () => {
            const state = stateService.getState();

            expect(state).toHaveProperty('sidebar_collapsed');
            expect(state).toHaveProperty('sidebar_width');
            expect(state).toHaveProperty('hidden_nav_items');
            expect(state).toHaveProperty('selected_modules');
        });
    });

    describe('sidebar state', () => {
        it('should get/set sidebar collapsed state', () => {
            expect(stateService.getSidebarCollapsed()).toBe(false);

            stateService.setSidebarCollapsed(true);
            expect(stateService.getSidebarCollapsed()).toBe(true);
        });

        it('should get/set sidebar width', () => {
            expect(stateService.getSidebarWidth()).toBe(280);

            stateService.setSidebarWidth(400);
            expect(stateService.getSidebarWidth()).toBe(400);
        });
    });

    describe('hidden nav items', () => {
        it('should get/set hidden nav items', () => {
            expect(stateService.getHiddenNavItems()).toEqual([]);

            stateService.setHiddenNavItems(['debug', 'settings']);
            expect(stateService.getHiddenNavItems()).toEqual(['debug', 'settings']);
        });
    });

    describe('hidden monitors', () => {
        it('should get/set hidden monitors', () => {
            expect(stateService.getHiddenMonitors()).toEqual([]);

            stateService.setHiddenMonitors(['cpu', 'ram']);
            expect(stateService.getHiddenMonitors()).toEqual(['cpu', 'ram']);
        });
    });

    describe('card widths', () => {
        it('should get all card widths', () => {
            expect(stateService.getCardWidths()).toEqual({});
        });

        it('should set individual card width', () => {
            stateService.setCardWidth('monitoring-card', '400px');
            expect(stateService.getCardWidths()).toEqual({ 'monitoring-card': '400px' });
        });
    });

    describe('download settings', () => {
        it('should get default download settings', () => {
            const settings = stateService.getDownloadSettings();
            expect(settings.limitEnabled).toBe(false);
            expect(settings.maxSpeed).toBe(50);
        });

        it('should set download settings', () => {
            stateService.setDownloadSettings(true, 100);
            const settings = stateService.getDownloadSettings();
            expect(settings.limitEnabled).toBe(true);
            expect(settings.maxSpeed).toBe(100);
        });
    });

    describe('selected modules', () => {
        it('should get/set selected modules', () => {
            expect(stateService.getSelectedModules()).toEqual({});

            stateService.setSelectedModule('browser', { id: 'chrome', name: 'Chrome' });
            expect(stateService.getSelectedModule('browser')).toEqual({
                id: 'chrome',
                name: 'Chrome',
            });
        });

        it('should remove selected module', () => {
            stateService.setSelectedModule('browser', { id: 'chrome' });
            stateService.removeSelectedModule('browser');
            expect(stateService.getSelectedModule('browser')).toBeUndefined();
        });
    });

    describe('last page', () => {
        it('should get/set last page', () => {
            // Default is undefined, but getLastPage returns '' for undefined
            stateService.setLastPage('settings');
            expect(stateService.getLastPage()).toBe('settings');
        });
    });

    describe('zoom level', () => {
        it('should get/set zoom level', () => {
            expect(stateService.getZoomLevel()).toBe(1);

            stateService.setZoomLevel(1.5);
            expect(stateService.getZoomLevel()).toBe(1.5);
        });
    });

    describe('saveAsync', () => {
        it('should save state to backend when dirty', async () => {
            mockInvoke.mockResolvedValueOnce(undefined);

            stateService.set('sidebar_collapsed', true);
            await stateService.saveAsync();

            expect(mockInvoke).toHaveBeenCalledWith('save_ui_state', {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                state: expect.objectContaining({
                    sidebar_collapsed: true,
                }),
            });
        });

        it('should not save when not dirty', async () => {
            await stateService.saveAsync();
            expect(mockInvoke).not.toHaveBeenCalled();
        });
    });

    describe('saveImmediate', () => {
        it('should immediately save state when dirty', () => {
            stateService.set('sidebar_width', 500);
            stateService.saveImmediate();

            expect(mockInvoke).toHaveBeenCalledWith('save_ui_state', expect.any(Object));
        });

        it('should use localStorage when Tauri is missing', () => {
            delete (globalThis as Record<string, unknown>)['__TAURI__'];
            delete (globalThis as Record<string, unknown>)['__TAURI_INTERNALS__'];
            (mockCore.tauriProvider.isTauri as unknown as Mock).mockReturnValue(false);

            stateService.set('sidebar_width', 500);
            stateService.saveImmediate();

            expect(localStorageMock.setItem).toHaveBeenCalled();

            // Restore
            (globalThis as Record<string, unknown>)['__TAURI__'] = tauriMock;
            (globalThis as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {
                invoke: async () => {
                    await Promise.resolve();
                },
                transformCallback: () => 0,
            };
            (mockCore.tauriProvider.isTauri as unknown as Mock).mockReturnValue(true);
        });
    });
});
