import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneralSettingsRenderer } from './GeneralSettingsRenderer';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

class ResizeObserverMock {
    public static instances: ResizeObserverMock[] = [];
    public readonly observe = vi.fn();
    public readonly disconnect = vi.fn();
    public callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        ResizeObserverMock.instances.push(this);
    }
}

describe('GeneralSettingsRenderer', () => {
    let renderer: GeneralSettingsRenderer;
    let uiSettings: {
        getHiddenNavItems: ReturnType<typeof vi.fn>;
        setHiddenNavItems: ReturnType<typeof vi.fn>;
        getHiddenMonitors: ReturnType<typeof vi.fn>;
        setHiddenMonitors: ReturnType<typeof vi.fn>;
    };
    let tracer: LoggerService;
    let runtime: NonNullable<ConstructorParameters<typeof GeneralSettingsRenderer>[2]>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('ResizeObserver', ResizeObserverMock as never);

        document.body.innerHTML = `
            <div id="taskbar-toggles"></div>
            <div id="monitor-toggles"></div>
            <template id="tpl-taskbar-toggle">
                <button class="monitor-toggle-btn active">
                    <svg><use></use></svg>
                    <span class="toggle-label"></span>
                </button>
            </template>
            <template id="tpl-monitor-toggle">
                <button class="monitor-toggle-btn active">
                    <svg><use></use></svg>
                    <span class="toggle-label"></span>
                </button>
            </template>
            <div id="sidebar">
                <button class="nav-btn" data-page="home"></button>
                <button class="nav-btn" data-page="chat"></button>
                <button class="nav-btn" data-page="modules"></button>
                <button class="nav-btn" data-page="console"></button>
                <button class="nav-btn" data-page="downloads"></button>
            </div>
            <div id="system-monitor">
                <div class="sysmon-stat" data-monitor-id="cpu"></div>
                <div class="sysmon-stat" data-monitor-id="gpu"></div>
                <div class="sysmon-stat" data-monitor-id="ram"></div>
                <div class="sysmon-stat" data-monitor-id="vram"></div>
                <div class="sysmon-stat" data-monitor-id="disk"></div>
                <div class="sysmon-stat" data-monitor-id="network"></div>
                <div class="sysmon-divider"></div>
            </div>
        `;

        uiSettings = {
            getHiddenNavItems: vi.fn(() => ['chat']),
            setHiddenNavItems: vi.fn(),
            getHiddenMonitors: vi.fn(() => ['gpu']),
            setHiddenMonitors: vi.fn(),
        };

        tracer = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as LoggerService;

        runtime = {
            requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
                callback(0);
                return 1;
            }),
            cancelAnimationFrame: vi.fn(),
            setTimeout: vi.fn((callback: () => void, delayMs: number) =>
                globalThis.setTimeout(callback, delayMs),
            ),
            clearTimeout: vi.fn((handle: ReturnType<typeof setTimeout>) => {
                globalThis.clearTimeout(handle);
            }),
        };

        renderer = new GeneralSettingsRenderer(uiSettings as never, tracer, runtime);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        document.body.innerHTML = '';
        ResizeObserverMock.instances = [];
    });

    it('renders taskbar and monitor toggles with translated labels and hidden state', () => {
        renderer.init({
            t: (key: string, fallback: string) => `t:${key}:${fallback}`,
        } as never);

        const taskbarButtons = document.querySelectorAll('#taskbar-toggles .monitor-toggle-btn');
        const monitorButtons = document.querySelectorAll('#monitor-toggles .monitor-toggle-btn');
        expect(taskbarButtons.length).toBeGreaterThan(0);
        expect(monitorButtons.length).toBe(6);

        const chatButton = document.querySelector(
            '#taskbar-toggles .monitor-toggle-btn[data-page-id="chat"]',
        ) as HTMLElement;
        expect(chatButton.classList.contains('active')).toBe(false);
        expect(
            document
                .querySelector('#sidebar .nav-btn[data-page="chat"]')
                ?.classList.contains('hidden'),
        ).toBe(true);
        expect(
            document.querySelector('#sidebar .nav-btn[data-page="chat"]')?.getAttribute('tabindex'),
        ).toBe('-1');
        expect(chatButton.querySelector<HTMLElement>('.toggle-label')?.dataset['i18n']).toBe(
            'ui.launcher.web.chat',
        );
        expect(chatButton.querySelector<HTMLElement>('.toggle-label')?.textContent).toBe(
            't:ui.launcher.web.chat:Chat',
        );

        const gpuMonitor = document.querySelector(
            '#monitor-toggles .monitor-toggle-btn[data-monitor-id="gpu"]',
        ) as HTMLElement;
        expect(gpuMonitor.classList.contains('active')).toBe(false);
        expect(
            document
                .querySelector('#system-monitor .sysmon-stat[data-monitor-id="gpu"]')
                ?.classList.contains('hidden'),
        ).toBe(true);
    });

    it('toggles nav items and monitor items, persisting hidden lists', () => {
        renderer.init({
            t: (_key: string, fallback: string) => fallback,
        } as never);

        renderer.toggleNavItem('home', false);
        expect(uiSettings.setHiddenNavItems).toHaveBeenCalledWith(['chat', 'home']);

        const homeNav = document.querySelector(
            '#sidebar .nav-btn[data-page="home"]',
        ) as HTMLElement;
        expect(homeNav.classList.contains('nav-item-hiding')).toBe(true);
        homeNav.dispatchEvent(new TransitionEvent('transitionend', { bubbles: true }));
        expect(homeNav.classList.contains('hidden')).toBe(true);
        expect(homeNav.getAttribute('tabindex')).toBe('-1');
        expect(homeNav.getAttribute('aria-hidden')).toBe('true');
        expect((homeNav as HTMLButtonElement).disabled).toBe(true);

        uiSettings.getHiddenNavItems.mockReturnValue(['chat', 'home']);
        renderer.toggleNavItem('home', true);
        expect(uiSettings.setHiddenNavItems).toHaveBeenLastCalledWith(['chat']);
        expect(homeNav.classList.contains('hidden')).toBe(false);
        expect(homeNav.hasAttribute('tabindex')).toBe(false);
        expect(homeNav.hasAttribute('aria-hidden')).toBe(false);
        expect((homeNav as HTMLButtonElement).disabled).toBe(false);

        renderer.toggleMonitorItem('cpu', false);
        expect(uiSettings.setHiddenMonitors).toHaveBeenCalledWith(['gpu', 'cpu']);

        const cpuStat = document.querySelector(
            '#system-monitor .sysmon-stat[data-monitor-id="cpu"]',
        ) as HTMLElement;
        cpuStat.dispatchEvent(new TransitionEvent('transitionend', { bubbles: true }));
        expect(cpuStat.classList.contains('hidden')).toBe(true);

        uiSettings.getHiddenMonitors.mockReturnValue(['gpu', 'cpu']);
        renderer.toggleMonitorItem('cpu', true);
        expect(uiSettings.setHiddenMonitors).toHaveBeenLastCalledWith(['gpu']);
        expect(cpuStat.classList.contains('hidden')).toBe(false);
    });

    it('does not mutate hidden state arrays returned by settings service', () => {
        const hiddenNavItems = ['chat'];
        const hiddenMonitors = ['gpu'];

        uiSettings.getHiddenNavItems.mockReturnValue(hiddenNavItems);
        uiSettings.getHiddenMonitors.mockReturnValue(hiddenMonitors);

        renderer.init({
            t: (_key: string, fallback: string) => fallback,
        } as never);

        renderer.toggleNavItem('home', false);
        renderer.toggleMonitorItem('cpu', false);

        expect(hiddenNavItems).toEqual(['chat']);
        expect(hiddenMonitors).toEqual(['gpu']);
        expect(uiSettings.setHiddenNavItems).toHaveBeenLastCalledWith(['chat', 'home']);
        expect(uiSettings.setHiddenMonitors).toHaveBeenLastCalledWith(['gpu', 'cpu']);
    });

    it('updates monitor panel and divider visibility based on hidden monitors', () => {
        renderer.init({
            t: (_key: string, fallback: string) => fallback,
        } as never);

        const panel = document.getElementById('system-monitor') as HTMLElement;
        const divider = document.querySelector('.sysmon-divider') as HTMLElement;
        expect(panel.classList.contains('adaptive-hidden')).toBe(false);
        expect(divider.classList.contains('hidden')).toBe(false);

        uiSettings.getHiddenMonitors.mockReturnValue([
            'cpu',
            'gpu',
            'ram',
            'vram',
            'disk',
            'network',
        ]);
        renderer.toggleMonitorItem('network', false);
        const networkStat = document.querySelector(
            '#system-monitor .sysmon-stat[data-monitor-id="network"]',
        ) as HTMLElement;
        expect(panel.classList.contains('adaptive-hidden')).toBe(false);
        networkStat.dispatchEvent(new TransitionEvent('transitionend', { bubbles: true }));
        expect(panel.classList.contains('adaptive-hidden')).toBe(true);

        uiSettings.getHiddenMonitors.mockReturnValue(['cpu', 'gpu', 'ram', 'vram']);
        renderer.toggleMonitorItem('disk', false);
        divider.dispatchEvent(new TransitionEvent('transitionend', { bubbles: true }));
        expect(divider.classList.contains('hidden')).toBe(true);
    });

    it('applies compact classes through ResizeObserver and avoids double initialization', () => {
        renderer.init({
            t: (_key: string, fallback: string) => fallback,
        } as never);
        renderer.init({
            t: (_key: string, fallback: string) => `ignored:${fallback}`,
        } as never);

        expect(document.querySelectorAll('#taskbar-toggles .monitor-toggle-btn')).toHaveLength(5);
        expect(ResizeObserverMock.instances).toHaveLength(2);

        const taskbar = document.getElementById('taskbar-toggles') as HTMLElement;
        ResizeObserverMock.instances[0]?.callback(
            [
                {
                    contentRect: { width: 280 } as DOMRectReadOnly,
                    target: taskbar,
                } as unknown as ResizeObserverEntry,
            ],
            {} as ResizeObserver,
        );
        expect(taskbar.classList.contains('compact')).toBe(true);
        expect(taskbar.classList.contains('super-compact')).toBe(true);
    });

    it('gracefully handles missing templates and containers', () => {
        document.getElementById('taskbar-toggles')?.remove();
        document.getElementById('tpl-monitor-toggle')?.remove();

        expect(() =>
            renderer.init({
                t: (_key: string, fallback: string) => fallback,
            } as never),
        ).not.toThrow();
    });
});
