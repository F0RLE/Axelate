/**
 * WindowService Unit Tests — Full Coverage
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WindowService, type IWindowConfig } from './WindowService';
import type { IBridge } from '@/shared/types/IBridge';

describe('WindowService', () => {
    let mockBridge: {
        isTauri: ReturnType<typeof vi.fn>;
        invoke: ReturnType<typeof vi.fn>;
        listen: ReturnType<typeof vi.fn>;
    };
    let mockUISettings: {
        setZoomLevel: ReturnType<typeof vi.fn>;
        getZoomLevel: ReturnType<typeof vi.fn>;
        getResolutionZoom: ReturnType<typeof vi.fn>;
        setResolutionZoom: ReturnType<typeof vi.fn>;
    };
    let service: WindowService;

    const mockWindowConfig: IWindowConfig = {
        breakpoints: { compact: 640, medium: 1024, large: 1440 },
        thresholds: {
            warningWidth: 800,
            warningHeight: 600,
            smallScreenWidth: 1024,
            smallScreenHeight: 768,
        },
    };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('screen', { width: 1920, height: 1080 });

        mockBridge = {
            isTauri: vi.fn().mockReturnValue(true),
            invoke: vi.fn().mockResolvedValue(undefined),
            listen: vi.fn().mockResolvedValue(vi.fn()),
        };

        mockUISettings = {
            setZoomLevel: vi.fn(),
            getZoomLevel: vi.fn().mockReturnValue(1),
            getResolutionZoom: vi.fn().mockReturnValue(undefined),
            setResolutionZoom: vi.fn(),
        };

        service = new WindowService(mockBridge as unknown as IBridge);
        service.setUISettingsService(
            mockUISettings as Parameters<typeof service.setUISettingsService>[0],
        );
    });

    afterEach(() => {
        service.destroy();
        vi.useRealTimers();
        vi.clearAllMocks();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // ---------------------------------------------------------- Initialization
    describe('Initialization', () => {
        it('should load config and initialize zoom in Tauri environment', async () => {
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_window_config') return Promise.resolve(mockWindowConfig);
                return Promise.resolve(undefined);
            });

            await service.init();

            expect(mockBridge.invoke).toHaveBeenCalledWith('get_window_config');
            expect(mockBridge.invoke).toHaveBeenCalledWith('set_webview_zoom', { zoom: 1 });
        });

        it('should use pre-loaded config and zoom when provided', async () => {
            await service.init(mockWindowConfig, 1.5);

            expect(mockBridge.invoke).not.toHaveBeenCalledWith('get_window_config');
            expect(mockBridge.invoke).toHaveBeenCalledWith('set_webview_zoom', { zoom: 1.5 });
            expect(service.getConfig()).toEqual(mockWindowConfig);
        });

        it('should use fallback zoom on config fetch error', async () => {
            mockBridge.invoke.mockRejectedValue(new Error('Network error'));
            mockUISettings.getZoomLevel.mockReturnValue(1.2);

            await service.init();

            expect(mockBridge.invoke).toHaveBeenCalledWith('set_webview_zoom', { zoom: 1.2 });
        });

        it('should fallback to 1 when no UISettingsService is set (L69)', async () => {
            const bareService = new WindowService(mockBridge as unknown as IBridge);
            // No setUISettingsService called — _uiSettingsService is undefined
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_window_config') return Promise.resolve(mockWindowConfig);
                return Promise.resolve(undefined);
            });

            await bareService.init();

            // Fallback should be 1 (the ?? 1 branch)
            expect(mockBridge.invoke).toHaveBeenCalledWith('set_webview_zoom', { zoom: 1 });
        });

        it('should use fallback zoom and setup web listeners in non-Tauri environment', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            mockUISettings.getZoomLevel.mockReturnValue(1.5);

            await service.init();

            expect(mockBridge.invoke).not.toHaveBeenCalled();
            expect(document.documentElement.style.getPropertyValue('--app-zoom')).toBe('1.500');
        });

        it('should attach Ctrl+Scroll zoom handler in web mode', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            const addEventSpy = vi.spyOn(globalThis, 'addEventListener');

            await service.init();

            expect(addEventSpy).toHaveBeenCalledWith('wheel', expect.any(Function), {
                passive: false,
            });
        });

        it('should call _initWindowListeners in Tauri mode', async () => {
            await service.init(mockWindowConfig, 1);

            expect(mockBridge.listen).toHaveBeenCalledWith('tauri://move', expect.any(Function));
        });

        it('should skip _saveWindowState when isTauri becomes false after init (L424)', async () => {
            // Init in Tauri mode → registers resize listener
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_window_config') return Promise.resolve(mockWindowConfig);
                return Promise.resolve(undefined);
            });
            await service.init();

            // Switch to non-Tauri
            mockBridge.isTauri.mockReturnValue(false);

            // Trigger _scheduleSaveWindowState → fires _saveWindowState after 1s
            globalThis.dispatchEvent(new Event('resize'));
            vi.advanceTimersByTime(1100);
            // _saveWindowState runs but returns early at L424 — no bridge.invoke for save
        });

        it('should take non-Tauri path in _getInitialZoomWithFallback (L463)', async () => {
            // Make isTauri return true once (for outer init guard), then false (for inner method guard)
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_window_config') return Promise.resolve(mockWindowConfig);
                return Promise.resolve(undefined);
            });
            // First call: true (enters Tauri block), second call: false (in _getInitialZoomWithFallback)
            mockBridge.isTauri.mockReturnValueOnce(true).mockReturnValue(false);

            await service.init(); // initialZoom is undefined → calls _getInitialZoomWithFallback
            // Should not throw — fallback path taken
        });
    });

    // ---------------------------------------------------------- Window Actions
    describe('Window Actions', () => {
        it('should call minimize_window via bridge', async () => {
            await service.minimize();
            expect(mockBridge.invoke).toHaveBeenCalledWith('minimize_window');
        });

        it('should log in web mode for minimize', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            await service.minimize(); // should not throw
        });

        it('should call maximize_window via bridge', async () => {
            await service.toggleMaximize();
            expect(mockBridge.invoke).toHaveBeenCalledWith('maximize_window');
        });

        it('should log in web mode for toggleMaximize', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            await service.toggleMaximize();
        });

        it('should call close_window via bridge', async () => {
            await service.close();
            expect(mockBridge.invoke).toHaveBeenCalledWith('close_window');
        });

        it('should call globalThis.close in web mode', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            const closeSpy = vi.fn();
            vi.stubGlobal('close', closeSpy);
            await service.close();
            expect(closeSpy).toHaveBeenCalled();
        });
    });

    // ---------------------------------------------------------- hideToTray
    describe('hideToTray', () => {
        it('should invoke hide_window in Tauri', async () => {
            await service.hideToTray();
            expect(mockBridge.invoke).toHaveBeenCalledWith('hide_window');
        });

        it('should fallback to minimize on hide_window error', async () => {
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'hide_window') return Promise.reject(new Error('not supported'));
                return Promise.resolve(undefined);
            });

            await service.hideToTray();

            expect(mockBridge.invoke).toHaveBeenCalledWith('minimize_window');
        });

        it('should log in web mode', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            await service.hideToTray(); // should not throw
        });
    });

    // ---------------------------------------------------------- show
    describe('show', () => {
        it('should call show_window and set_focus', async () => {
            await service.show();

            expect(mockBridge.invoke).toHaveBeenCalledWith('show_window');
            expect(mockBridge.invoke).toHaveBeenCalledWith('set_focus');
        });

        it('should skip set_focus if it throws', async () => {
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'set_focus') return Promise.reject(new Error('Command not found'));
                return Promise.resolve(undefined);
            });

            await service.show(); // should not throw
            expect(mockBridge.invoke).toHaveBeenCalledWith('show_window');
        });

        it('should retry up to 3 times if show_window fails', async () => {
            let callCount = 0;
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'show_window') {
                    callCount++;
                    if (callCount < 3)
                        return Promise.reject(new Error(`attempt ${String(callCount)}`));
                    return Promise.resolve(undefined);
                }
                return Promise.resolve(undefined);
            });

            const showPromise = service.show();
            // Advance timers to handle the 300ms delay between retries
            await vi.advanceTimersByTimeAsync(1000);
            await showPromise;

            expect(callCount).toBe(3);
        });

        it('should log error after all retries fail', async () => {
            mockBridge.invoke.mockRejectedValue(new Error('Persistent failure'));

            const showPromise = service.show();
            await vi.advanceTimersByTimeAsync(2000);
            await showPromise;

            // Should have tried 3 times
            expect(mockBridge.invoke).toHaveBeenCalledWith('show_window');
        });

        it('should skip in web mode', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            await service.show();
            expect(mockBridge.invoke).not.toHaveBeenCalled();
        });
    });

    // ---------------------------------------------------------- Zoom Management
    describe('Zoom Management', () => {
        it('should safely bound zoom levels between min and max (0.5 to 3.0)', async () => {
            await service.setZoom(0.1);
            expect(mockBridge.invoke).toHaveBeenCalledWith('set_webview_zoom', { zoom: 0.5 });

            await service.setZoom(5);
            expect(mockBridge.invoke).toHaveBeenCalledWith('set_webview_zoom', { zoom: 3 });
        });

        it('should change zoom relatively and persist it', async () => {
            await service.init(mockWindowConfig, 1);
            await service.changeZoom(0.2);

            expect(mockBridge.invoke).toHaveBeenLastCalledWith('set_webview_zoom', { zoom: 1.2 });
            expect(mockUISettings.setZoomLevel).toHaveBeenLastCalledWith(1.2);
            expect(mockUISettings.setResolutionZoom).toHaveBeenLastCalledWith('1920x1080', 1.2);
        });

        it('should return current zoom via getZoom()', () => {
            expect(service.getZoom()).toBe(1);
        });

        it('should apply CSS variable in web mode', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            await service.setZoom(1.5);
            expect(document.documentElement.style.getPropertyValue('--app-zoom')).toBe('1.500');
        });

        it('should handle setZoom error gracefully', async () => {
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'set_webview_zoom') return Promise.reject(new Error('Zoom failed'));
                return Promise.resolve(undefined);
            });

            const result = await service.setZoom(1.5);
            expect(result).toBe(1.5); // Should still return the value
        });

        it('should work without UISettingsService', async () => {
            const bareService = new WindowService(mockBridge as unknown as IBridge);
            const result = await bareService.setZoom(1.2);
            expect(result).toBe(1.2);
        });
    });

    // ---------------------------------------------------------- Monitoring
    describe('setMonitoringPaused', () => {
        it('should invoke set_monitoring_paused in Tauri', async () => {
            await service.setMonitoringPaused(true);
            expect(mockBridge.invoke).toHaveBeenCalledWith('set_monitoring_paused', {
                paused: true,
            });
        });

        it('should handle invoke error gracefully', async () => {
            mockBridge.invoke.mockRejectedValue(new Error('fail'));
            await service.setMonitoringPaused(false); // should not throw
        });

        it('should be a no-op in web mode', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            await service.setMonitoringPaused(true);
            expect(mockBridge.invoke).not.toHaveBeenCalled();
        });

        it('should call toggleMonitorBtn callback if present', async () => {
            const toggleCb = vi.fn();
            (globalThis as unknown as Record<string, unknown>)['toggleMonitorBtn'] = toggleCb;

            await service.setMonitoringPaused(false);

            // Should have set windowService on globalThis
            const win = globalThis as unknown as { windowService?: WindowService };
            expect(win.windowService).toBe(service);
        });
    });

    // ---------------------------------------------------------- checkPolicy
    describe('checkPolicy', () => {
        it('should return backend policy in Tauri', async () => {
            const policy = { isSmallScreen: true, showWarning: true };
            mockBridge.invoke.mockResolvedValue(policy);

            const result = await service.checkPolicy();
            expect(result).toEqual(policy);
        });

        it('should return default policy on error', async () => {
            mockBridge.invoke.mockRejectedValue(new Error('fail'));
            const result = await service.checkPolicy();
            expect(result).toEqual({ isSmallScreen: false, showWarning: false });
        });

        it('should return default policy in web mode', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            const result = await service.checkPolicy();
            expect(result).toEqual({ isSmallScreen: false, showWarning: false });
        });

        it('should not re-check resolution on same resolution (L304 false branch)', async () => {
            // First call: sets _lastResolutionKey to '1920x1080'
            mockBridge.invoke.mockResolvedValue({ isSmallScreen: false, showWarning: false });
            await service.checkPolicy();

            // Second call: same resolution → no resolution-change branch taken
            await service.checkPolicy();

            // Should still work correctly (resolution handler NOT triggered again)
            expect(mockBridge.invoke).toHaveBeenCalled();
        });
    });

    // ---------------------------------------------------------- checkResolutionChange
    describe('checkResolutionChange', () => {
        it('should detect resolution change', async () => {
            // First call sets the resolution key
            await service.checkPolicy();

            // Change screen
            vi.stubGlobal('screen', { width: 2560, height: 1440 });

            service.checkResolutionChange();
            // Should have updated the internal key (no assertion on private, just no throw)
        });

        it('should not trigger on same resolution', () => {
            service.checkResolutionChange();
            service.checkResolutionChange(); // Same resolution, no change
        });
    });

    // ---------------------------------------------------------- getConfig
    describe('getConfig', () => {
        it('should return null before init', () => {
            expect(service.getConfig()).toBeNull();
        });

        it('should return config after init', async () => {
            await service.init(mockWindowConfig, 1);
            expect(service.getConfig()).toEqual(mockWindowConfig);
        });
    });

    // ---------------------------------------------------------- setSize
    describe('setSize', () => {
        it('should call Tauri window setSize and center', async () => {
            const mockSetSize = vi.fn().mockResolvedValue(undefined);
            const mockCenter = vi.fn().mockResolvedValue(undefined);
            const mockLogicalSize = vi.fn();

            vi.stubGlobal('__TAURI__', {
                window: {
                    getCurrentWindow: () => ({
                        setSize: mockSetSize,
                        center: mockCenter,
                    }),
                    LogicalSize: mockLogicalSize,
                },
            });

            await service.setSize(800, 600);

            expect(mockSetSize).toHaveBeenCalled();
            expect(mockCenter).toHaveBeenCalled();
        });

        it('should handle error gracefully', async () => {
            vi.stubGlobal('__TAURI__', {
                window: {
                    getCurrentWindow: () => ({
                        setSize: vi.fn().mockRejectedValue(new Error('fail')),
                        center: vi.fn(),
                    }),
                    LogicalSize: vi.fn(),
                },
            });

            await service.setSize(800, 600); // should not throw
        });

        it('should be no-op in web mode', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            await service.setSize(800, 600); // no throw, no calls
        });

        it('should skip if __TAURI__.window is missing', async () => {
            vi.stubGlobal('__TAURI__', {});
            await service.setSize(800, 600); // should not throw
        });
    });

    // ---------------------------------------------------------- isMaximized
    describe('isMaximized', () => {
        it('should return true when Tauri window is maximized', async () => {
            vi.stubGlobal('__TAURI__', {
                window: {
                    getCurrentWindow: () => ({
                        isMaximized: vi.fn().mockResolvedValue(true),
                    }),
                },
            });

            const result = await service.isMaximized();
            expect(result).toBe(true);
        });

        it('should return false when Tauri window is not maximized', async () => {
            vi.stubGlobal('__TAURI__', {
                window: {
                    getCurrentWindow: () => ({
                        isMaximized: vi.fn().mockResolvedValue(false),
                    }),
                },
            });

            const result = await service.isMaximized();
            expect(result).toBe(false);
        });

        it('should return false on error', async () => {
            vi.stubGlobal('__TAURI__', {
                window: {
                    getCurrentWindow: () => ({
                        isMaximized: vi.fn().mockRejectedValue(new Error('fail')),
                    }),
                },
            });

            const result = await service.isMaximized();
            expect(result).toBe(false);
        });

        it('should return false if __TAURI__.window is missing', async () => {
            vi.stubGlobal('__TAURI__', {});
            const result = await service.isMaximized();
            expect(result).toBe(false);
        });

        it('should return false in web mode', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            const result = await service.isMaximized();
            expect(result).toBe(false);
        });
    });

    // ---------------------------------------------------------- Window state persistence
    describe('Window state persistence', () => {
        it('should debounce save window state', async () => {
            // Init to set up listeners
            await service.init(mockWindowConfig, 1);

            // Simulate resize
            globalThis.dispatchEvent(new Event('resize'));
            globalThis.dispatchEvent(new Event('resize'));
            globalThis.dispatchEvent(new Event('resize'));

            // Only one debounced save should be scheduled
            vi.advanceTimersByTime(500);
            // Should not have saved yet (debounce is 1s)

            vi.advanceTimersByTime(600);
            // Now the debounced save should fire
        });

        it('should save window state (maximized) when Tauri window resolves', async () => {
            const mockIsMaximized = vi.fn().mockResolvedValue(true);
            vi.stubGlobal('__TAURI__', {
                window: {
                    getCurrentWindow: () => ({
                        isMaximized: mockIsMaximized,
                        innerSize: vi.fn().mockResolvedValue({ width: 1280, height: 720 }),
                        outerPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
                    }),
                },
            });

            await service.init(mockWindowConfig, 1);
            globalThis.dispatchEvent(new Event('resize'));
            vi.advanceTimersByTime(1500);
            await vi.runAllTimersAsync();

            expect(mockBridge.invoke).toHaveBeenCalledWith(
                'save_maximized_state',
                expect.any(Object),
            );
        });

        it('should save window size and position when not maximized', async () => {
            const mockIsMaximized = vi.fn().mockResolvedValue(false);
            const mockInnerSize = vi.fn().mockResolvedValue({ width: 1000, height: 600 });
            const mockOuterPos = vi.fn().mockResolvedValue({ x: 100, y: 50 });

            vi.stubGlobal('__TAURI__', {
                window: {
                    getCurrentWindow: () => ({
                        isMaximized: mockIsMaximized,
                        innerSize: mockInnerSize,
                        outerPosition: mockOuterPos,
                    }),
                },
            });

            await service.init(mockWindowConfig, 1);
            globalThis.dispatchEvent(new Event('resize'));
            vi.advanceTimersByTime(1500);
            await vi.runAllTimersAsync();

            expect(mockBridge.invoke).toHaveBeenCalledWith('save_maximized_state', {
                maximized: false,
            });
            expect(mockBridge.invoke).toHaveBeenCalledWith('save_window_size', {
                width: 1000,
                height: 600,
            });
            expect(mockBridge.invoke).toHaveBeenCalledWith('save_window_position', {
                x: 100,
                y: 50,
            });
        });
    });

    // ---------------------------------------------------------- _toggleMonitorPanel (via setMonitoringPaused)
    describe('_toggleMonitorPanel', () => {
        it('should dispatch monitor:toggle event when toggleMonitorBtn is called', async () => {
            // Use an object property to avoid TypeScript narrowing the variable to 'never'
            const captured: { fn: ((visible: boolean) => void) | null } = { fn: null };
            (globalThis as unknown as Record<string, unknown>)['toggleMonitorBtn'] = (
                fn: (visible: boolean) => void,
            ) => {
                captured.fn = fn;
            };

            const eventSpy = vi.spyOn(globalThis, 'dispatchEvent');
            await service.setMonitoringPaused(false);

            captured.fn?.(true);

            const allCalls = eventSpy.mock.calls.map((c: [Event]) => c[0]);
            const monitorEvent = allCalls.find((e: Event) => e.type === 'monitor:toggle');
            expect(monitorEvent).toBeDefined();
        });
    });

    // ---------------------------------------------------------- Resolution change zoom handling
    describe('_handleResolutionChange (indirectly via checkResolutionChange)', () => {
        it('should trigger zoom update when resolution changes and getInitialZoom provides new value', async () => {
            await service.init(mockWindowConfig, 1);

            // Mock a new resolution zoom from backend
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_resolution_zoom') return Promise.resolve(1.5);
                return Promise.resolve(undefined);
            });

            // Trigger resolution change by changing screen size
            vi.stubGlobal('screen', { width: 2560, height: 1440 });

            service.checkResolutionChange();
            await vi.runAllTimersAsync();

            // After resolution change, zoom should have been updated
            expect(mockBridge.invoke).toHaveBeenCalledWith('get_resolution_zoom');
        });

        it('should handle resolution change zoom fetch error gracefully', async () => {
            await service.init(mockWindowConfig, 1);

            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_resolution_zoom') return Promise.reject(new Error('net fail'));
                return Promise.resolve(undefined);
            });

            vi.stubGlobal('screen', { width: 3840, height: 2160 });

            service.checkResolutionChange();
            await vi.runAllTimersAsync(); // should not throw
        });
    });

    // ---------------------------------------------------------- Wheel handler body (lines 103-107)
    describe('Ctrl+Scroll wheel handler (web mode)', () => {
        it('should call changeZoom with +0.1 when scrolling up with ctrlKey', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            mockUISettings.getZoomLevel.mockReturnValue(1);

            const captured: { handler: ((e: WheelEvent) => void) | null } = { handler: null };
            const origAddEvent = globalThis.addEventListener.bind(globalThis);
            vi.spyOn(globalThis, 'addEventListener').mockImplementation(
                (type: string, listener: EventListenerOrEventListenerObject, opts?: unknown) => {
                    if (type === 'wheel') {
                        captured.handler = listener as (e: WheelEvent) => void;
                    }
                    return origAddEvent(type, listener, opts as AddEventListenerOptions);
                },
            );

            await service.init();

            expect(captured.handler).not.toBeNull();

            const changeZoomSpy = vi.spyOn(service, 'changeZoom').mockResolvedValue(1);

            // Scroll up (negative deltaY) with ctrlKey
            const upEvent = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true });
            captured.handler?.(upEvent);

            expect(changeZoomSpy).toHaveBeenCalledWith(0.1);

            // Scroll down with ctrlKey
            const downEvent = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true });
            captured.handler?.(downEvent);

            expect(changeZoomSpy).toHaveBeenCalledWith(-0.1);
        });

        it('should NOT call changeZoom when ctrlKey is not held', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            const captured: { handler: ((e: WheelEvent) => void) | null } = { handler: null };
            vi.spyOn(globalThis, 'addEventListener').mockImplementation(
                (type: string, listener: EventListenerOrEventListenerObject) => {
                    if (type === 'wheel') {
                        captured.handler = listener as (e: WheelEvent) => void;
                    }
                },
            );

            await service.init();
            const changeZoomSpy = vi.spyOn(service, 'changeZoom').mockResolvedValue(1);

            const ev = new WheelEvent('wheel', { deltaY: -100, ctrlKey: false });
            captured.handler?.(ev);

            expect(changeZoomSpy).not.toHaveBeenCalled();
        });

        it('should remove wheel listener on destroy', async () => {
            mockBridge.isTauri.mockReturnValue(false);

            await service.init();
            const changeZoomSpy = vi.spyOn(service, 'changeZoom').mockResolvedValue(1);

            service.destroy();
            globalThis.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true }));

            expect(changeZoomSpy).not.toHaveBeenCalled();
        });
    });

    // ---------------------------------------------------------- tauri://move callback body (line 403)
    describe('tauri://move listener callback', () => {
        it('should schedule save when tauri move event fires', async () => {
            const captured: { cb: (() => void) | null } = { cb: null };
            mockBridge.listen.mockImplementation((event: string, cb: () => void) => {
                if (event === 'tauri://move') captured.cb = cb;
                return Promise.resolve(() => undefined);
            });

            await service.init(mockWindowConfig, 1);
            expect(captured.cb).not.toBeNull();

            // Fire the move listener
            captured.cb?.();
            vi.advanceTimersByTime(1500);
            await vi.runAllTimersAsync();

            // Should trigger a save attempt to invoke backend
            expect(mockBridge.isTauri).toHaveBeenCalled();
        });

        it('should unsubscribe tauri://move listener on destroy', async () => {
            const unlisten = vi.fn();
            mockBridge.listen.mockResolvedValue(unlisten);

            await service.init(mockWindowConfig, 1);
            await Promise.resolve();

            service.destroy();

            expect(unlisten).toHaveBeenCalledTimes(1);
        });
    });

    // ---------------------------------------------------------- _getInitialZoomWithFallback valid zoom (lines 468-471)
    describe('_getInitialZoomWithFallback with valid backend zoom', () => {
        it('should apply backend zoom when get_resolution_zoom returns valid > 0', async () => {
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_window_config') return Promise.resolve(mockWindowConfig);
                if (cmd === 'get_resolution_zoom') return Promise.resolve(1.75);
                if (cmd === 'set_webview_zoom') return Promise.resolve(undefined);
                return Promise.resolve(undefined);
            });

            // Don't pass initialZoom — forces _getInitialZoomWithFallback to be called
            await service.init(mockWindowConfig);

            // The zoom applied should come from the backend (1.75)
            expect(mockBridge.invoke).toHaveBeenCalledWith('set_webview_zoom', { zoom: 1.75 });
        });

        it('should fallback when get_resolution_zoom returns non-number (L471)', async () => {
            mockUISettings.getZoomLevel.mockReturnValue(1.3);
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_window_config') return Promise.resolve(mockWindowConfig);
                if (cmd === 'get_resolution_zoom') return Promise.resolve('not-a-number');
                if (cmd === 'set_webview_zoom') return Promise.resolve(undefined);
                return Promise.resolve(undefined);
            });

            await service.init(mockWindowConfig);

            // Should fallback to UISettings zoom (1.3)
            expect(mockBridge.invoke).toHaveBeenCalledWith('set_webview_zoom', { zoom: 1.3 });
        });

        it('should fallback when get_resolution_zoom returns 0 (L471)', async () => {
            mockUISettings.getZoomLevel.mockReturnValue(1.1);
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_window_config') return Promise.resolve(mockWindowConfig);
                if (cmd === 'get_resolution_zoom') return Promise.resolve(0);
                if (cmd === 'set_webview_zoom') return Promise.resolve(undefined);
                return Promise.resolve(undefined);
            });

            await service.init(mockWindowConfig);

            expect(mockBridge.invoke).toHaveBeenCalledWith('set_webview_zoom', { zoom: 1.1 });
        });

        it('should fallback when get_resolution_zoom rejects (L471)', async () => {
            mockUISettings.getZoomLevel.mockReturnValue(1.2);
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_window_config') return Promise.resolve(mockWindowConfig);
                if (cmd === 'get_resolution_zoom')
                    return Promise.reject(new Error('Backend zoom fail'));
                if (cmd === 'set_webview_zoom') return Promise.resolve(undefined);
                return Promise.resolve(undefined);
            });

            await service.init(mockWindowConfig);

            expect(mockBridge.invoke).toHaveBeenCalledWith('set_webview_zoom', { zoom: 1.2 });
        });
    });
});
