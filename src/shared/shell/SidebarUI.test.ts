import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarUI } from './SidebarUI';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

vi.mock('@/assets/logos', () => ({
    mountLogos: vi.fn(),
}));

class ResizeObserverMock {
    public static instances: ResizeObserverMock[] = [];
    public readonly observe = vi.fn();
    public readonly disconnect = vi.fn();
    public readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        ResizeObserverMock.instances.push(this);
    }
}

describe('SidebarUI', () => {
    const uiSettings = {
        getSidebarCollapsed: vi.fn(() => false),
        getSidebarManualOverride: vi.fn(() => false),
        getSidebarWidth: vi.fn(() => 280),
        getZoomLevel: vi.fn(() => 1),
        getHiddenNavItems: vi.fn<() => string[]>(() => []),
        setSidebarState: vi.fn(),
    };

    const soundService = {
        playExpand: vi.fn(),
    };

    const windowService = {
        getConfig: vi.fn(() => null),
        getZoom: vi.fn(() => 1),
        getMaxSafeZoom: vi.fn(() => Number.POSITIVE_INFINITY),
        setMonitoringPaused: vi.fn().mockResolvedValue(undefined),
    };
    const tracer = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    } as unknown as LoggerService;

    function setupDom(): void {
        document.body.innerHTML = `
            <div id="sidebar">
                <div class="logo-area"></div>
                <div class="main-menu"></div>
                <div id="system-monitor"></div>
                <div class="bottom-menu"></div>
            </div>
        `;

        const sidebar = document.getElementById('sidebar') as HTMLElement;
        const logo = sidebar.querySelector('.logo-area') as HTMLElement;
        const menu = sidebar.querySelector('.main-menu') as HTMLElement;
        const bottom = sidebar.querySelector('.bottom-menu') as HTMLElement;
        const monitor = document.getElementById('system-monitor') as HTMLElement;

        Object.defineProperty(logo, 'offsetHeight', { configurable: true, value: 60 });
        Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 240 });
        Object.defineProperty(bottom, 'offsetHeight', { configurable: true, value: 80 });
        Object.defineProperty(monitor, 'offsetHeight', { configurable: true, value: 200 });
        Object.defineProperty(sidebar, 'clientHeight', { configurable: true, value: 900 });
        Object.defineProperty(sidebar, 'scrollHeight', { configurable: true, value: 900 });
    }

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', ResizeObserverMock as never);
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            callback(performance.now());
            return 1;
        }) as typeof globalThis.requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        setupDom();
        Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 1280 });
        Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 900 });
        uiSettings.getSidebarCollapsed.mockReturnValue(false);
        uiSettings.getSidebarManualOverride.mockReturnValue(false);
        uiSettings.getSidebarWidth.mockReturnValue(280);
        uiSettings.getZoomLevel.mockReturnValue(1);
        uiSettings.getHiddenNavItems.mockReturnValue([]);
        windowService.getConfig.mockReturnValue(null);
        windowService.getZoom.mockReturnValue(1);
        windowService.getMaxSafeZoom.mockReturnValue(Number.POSITIVE_INFINITY);
        windowService.setMonitoringPaused.mockResolvedValue(undefined);
        vi.clearAllMocks();
    });

    afterEach(() => {
        document.documentElement.style.removeProperty('--app-zoom');
        document.body.innerHTML = '';
        ResizeObserverMock.instances = [];
        vi.unstubAllGlobals();
    });

    it('renders navigation buttons into main and bottom menus', async () => {
        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        expect(document.querySelectorAll('.main-menu .nav-btn')).toHaveLength(6);
        expect(document.querySelectorAll('.bottom-menu .nav-btn')).toHaveLength(1);
        expect(document.querySelector('.console-trigger')?.getAttribute('data-page')).toBe(
            'console',
        );
    });

    it('restores hidden nav items from persisted ui settings on init', async () => {
        uiSettings.getHiddenNavItems.mockReturnValue(['chat', 'downloads']);
        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        expect(
            document.querySelector('.nav-btn[data-page="chat"]')?.classList.contains('hidden'),
        ).toBe(true);
        expect(
            document.querySelector('.nav-btn[data-page="downloads"]')?.classList.contains('hidden'),
        ).toBe(true);
        expect(document.querySelector('.nav-btn[data-page="chat"]')?.getAttribute('tabindex')).toBe(
            '-1',
        );
    });

    it('toggles collapsed state from logo interaction and persists width', async () => {
        vi.useFakeTimers();
        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        const logoArea = document.querySelector('.logo-area') as HTMLElement;
        logoArea.click();

        expect(uiSettings.setSidebarState).toHaveBeenCalledWith(true, 80, false);
        expect(soundService.playExpand).toHaveBeenCalledWith(false);
        expect(document.body.classList.contains('snapping')).toBe(true);

        vi.advanceTimersByTime(300);
        expect(document.body.classList.contains('snapping')).toBe(false);
        vi.useRealTimers();
    });

    it('hides monitor when available space is too small', async () => {
        const sidebar = document.getElementById('sidebar') as HTMLElement;
        Object.defineProperty(sidebar, 'clientHeight', { configurable: true, value: 200 });
        Object.defineProperty(sidebar, 'scrollHeight', { configurable: true, value: 500 });

        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        expect(
            document.getElementById('system-monitor')?.classList.contains('adaptive-hidden'),
        ).toBe(true);
        expect(sidebar.classList.contains('monitor-hidden')).toBe(true);
        expect(windowService.setMonitoringPaused).toHaveBeenCalledWith(true);
    });

    it('resumes monitoring when adaptive monitor is visible', async () => {
        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        expect(
            document.getElementById('system-monitor')?.classList.contains('adaptive-hidden'),
        ).toBe(false);
        expect(windowService.setMonitoringPaused).toHaveBeenCalledWith(false);
    });

    it('enables auto compact when zoom threshold is reached', async () => {
        windowService.getZoom.mockReturnValue(1.6);
        windowService.getMaxSafeZoom.mockReturnValue(1.6);
        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        const sidebar = document.getElementById('sidebar') as HTMLElement;
        expect(sidebar.classList.contains('auto-compact')).toBe(true);
        expect(sidebar.style.width).toBe('80px');
    });

    it('does not auto compact at the fallback threshold before max safe zoom', async () => {
        windowService.getZoom.mockReturnValue(1.6);
        windowService.getMaxSafeZoom.mockReturnValue(1.9);

        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        const sidebar = document.getElementById('sidebar') as HTMLElement;
        expect(sidebar.classList.contains('auto-compact')).toBe(false);
        expect(sidebar.style.width).toBe('280px');
    });

    it('updates auto compact when zoom changes after init', async () => {
        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        const sidebar = document.getElementById('sidebar') as HTMLElement;
        expect(sidebar.classList.contains('auto-compact')).toBe(false);

        windowService.getZoom.mockReturnValue(1.6);
        windowService.getMaxSafeZoom.mockReturnValue(1.6);
        globalThis.dispatchEvent(
            new CustomEvent('axelate:zoom-changed', { detail: { zoom: 1.6 } }),
        );

        expect(sidebar.classList.contains('auto-compact')).toBe(true);
        expect(sidebar.style.width).toBe('80px');
    });

    it('enables auto compact at the zoom threshold even with config thresholds', async () => {
        windowService.getConfig.mockReturnValue({
            thresholds: {
                warningWidth: 800,
                warningHeight: 600,
                smallScreenWidth: 1024,
                smallScreenHeight: 768,
            },
        } as never);
        Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 960 });
        Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 720 });
        windowService.getZoom.mockReturnValue(1.6);
        windowService.getMaxSafeZoom.mockReturnValue(1.6);

        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        const sidebar = document.getElementById('sidebar') as HTMLElement;
        expect(sidebar.classList.contains('auto-compact')).toBe(true);
        expect(sidebar.style.width).toBe('80px');
    });

    it('keeps viewport pressure separate from auto compact', async () => {
        windowService.getConfig.mockReturnValue({
            thresholds: {
                warningWidth: 800,
                warningHeight: 600,
                smallScreenWidth: 1024,
                smallScreenHeight: 768,
            },
        } as never);
        Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 960 });
        Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 720 });
        document.documentElement.style.setProperty('--app-zoom', '2.000');

        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        const sidebar = document.getElementById('sidebar') as HTMLElement;
        expect(sidebar.classList.contains('auto-compact')).toBe(false);
        expect(sidebar.style.width).toBe('280px');
    });

    it('hides monitoring before auto compacting as zoom increases', async () => {
        Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 1280 });
        Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 900 });
        const sidebarElement = document.getElementById('sidebar') as HTMLElement;
        Object.defineProperty(sidebarElement, 'clientHeight', { configurable: true, value: 640 });
        Object.defineProperty(sidebarElement, 'scrollHeight', { configurable: true, value: 700 });
        windowService.getZoom.mockReturnValue(1.4);
        windowService.getMaxSafeZoom.mockReturnValue(1.6);
        document.documentElement.style.setProperty('--app-zoom', '1.400');

        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        const sidebar = document.getElementById('sidebar') as HTMLElement;
        const monitor = document.getElementById('system-monitor') as HTMLElement;

        expect(monitor.classList.contains('adaptive-hidden')).toBe(true);
        expect(windowService.setMonitoringPaused).toHaveBeenCalledWith(true);
        expect(sidebar.classList.contains('auto-compact')).toBe(false);
        expect(sidebar.style.width).toBe('280px');

        windowService.getZoom.mockReturnValue(1.6);
        windowService.getMaxSafeZoom.mockReturnValue(1.6);
        document.documentElement.style.setProperty('--app-zoom', '1.600');
        globalThis.dispatchEvent(
            new CustomEvent('axelate:zoom-changed', { detail: { zoom: 1.6 } }),
        );

        expect(sidebar.classList.contains('auto-compact')).toBe(true);
        expect(sidebar.style.width).toBe('80px');
    });

    it('does not auto compact below the fixed zoom threshold', async () => {
        windowService.getConfig.mockReturnValue({
            thresholds: {
                warningWidth: 920,
                warningHeight: 640,
                smallScreenWidth: 1024,
                smallScreenHeight: 768,
            },
        } as never);
        Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 1200 });
        Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 800 });
        windowService.getZoom.mockReturnValue(1.25);
        document.documentElement.style.setProperty('--app-zoom', '1.250');

        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        const sidebar = document.getElementById('sidebar') as HTMLElement;
        expect(sidebar.classList.contains('auto-compact')).toBe(false);
        expect(sidebar.style.width).toBe('280px');
    });

    it('keeps manual logo toggle as priority while auto compact is active', async () => {
        windowService.getZoom.mockReturnValue(1.6);
        windowService.getMaxSafeZoom.mockReturnValue(1.6);
        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        const sidebar = document.getElementById('sidebar') as HTMLElement;
        const logoArea = document.querySelector('.logo-area') as HTMLElement;

        expect(sidebar.classList.contains('auto-compact')).toBe(true);
        expect(sidebar.style.width).toBe('80px');

        logoArea.click();

        expect(sidebar.classList.contains('auto-compact')).toBe(false);
        expect(sidebar.style.width).toBe('280px');
        expect(uiSettings.setSidebarState).toHaveBeenCalledWith(false, 280, true);
    });

    it('releases manual expansion back to auto compact on the next logo toggle', async () => {
        windowService.getZoom.mockReturnValue(1.6);
        windowService.getMaxSafeZoom.mockReturnValue(1.6);
        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        const sidebar = document.getElementById('sidebar') as HTMLElement;
        const logoArea = document.querySelector('.logo-area') as HTMLElement;

        logoArea.click();
        expect(sidebar.classList.contains('auto-compact')).toBe(false);
        expect(sidebar.style.width).toBe('280px');

        logoArea.click();

        expect(sidebar.classList.contains('auto-compact')).toBe(true);
        expect(sidebar.style.width).toBe('80px');
        expect(uiSettings.setSidebarState).toHaveBeenLastCalledWith(true, 80, false);
    });

    it('restores manual expanded state while auto compact is active', async () => {
        windowService.getZoom.mockReturnValue(1.6);
        windowService.getMaxSafeZoom.mockReturnValue(1.6);
        uiSettings.getSidebarCollapsed.mockReturnValue(false);
        uiSettings.getSidebarManualOverride.mockReturnValue(true);

        const sidebarUi = new SidebarUI(
            uiSettings as never,
            tracer,
            soundService as never,
            windowService as never,
        );

        await sidebarUi.init();

        const sidebar = document.getElementById('sidebar') as HTMLElement;
        expect(sidebar.classList.contains('auto-compact')).toBe(false);
        expect(sidebar.classList.contains('collapsed')).toBe(false);
        expect(sidebar.style.width).toBe('280px');
    });
});
