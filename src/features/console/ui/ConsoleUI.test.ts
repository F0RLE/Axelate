import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleUI } from './ConsoleUI';
import type { ConsoleLogService, ILogEntry } from '../services/ConsoleLogService';
import { ConsoleLogNormalizer } from '../services/ConsoleLogNormalizer';
import { EventBus } from '@/shared/services/EventBus';

describe('ConsoleUI lifecycle', () => {
    let ui: ConsoleUI | null = null;
    let testEventBus: EventBus;
    let showToastMock: ReturnType<typeof vi.fn>;
    const normalizer = new ConsoleLogNormalizer();

    function normalizeLogs(logs: ILogEntry[]): ILogEntry[] {
        return logs.map((log) => normalizer.normalize(log));
    }

    beforeEach(() => {
        testEventBus = new EventBus();
        document.body.innerHTML = `
            <input class="debug-slider-1" />
            <span class="debug-slider-1-value">0%</span>
            <input class="debug-slider-animated" />
            <span class="debug-slider-value">0%</span>
            <input class="debug-slider-3" />
            <span class="debug-slider-3-value">0%</span>
            <div class="debug-draggable"></div>
            <div class="debug-dropzone">Drop here</div>
            <button class="debug-tab"></button>
            <div id="debug-first-tab" class="debug-tab-content"></div>
            <div class="console-toolbar">
                <button class="console-tab-scroll console-tab-scroll-left" type="button" hidden></button>
                <div class="console-toolbar-left">
                    <button class="console-tab" data-view="general"></button>
                </div>
                <button class="console-tab-scroll console-tab-scroll-right" type="button" hidden></button>
            </div>
            <div id="console-runtime-cards" class="console-runtime-cards" hidden></div>
            <div id="page-console" class="active"></div>
            <div class="console-workspace">
                <div id="console-container" class="console-logs-area">
                    <div id="logs">
                        <div id="logs-general" class="logs-pane active"></div>
                    </div>
                </div>
                <aside class="console-controls-panel">
                    <div class="console-level-filters">
                        <button class="console-filter-chip active" data-level="ERROR" type="button"></button>
                        <button class="console-filter-chip active" data-level="WARN" type="button"></button>
                        <button class="console-filter-chip active" data-level="INFO" type="button"></button>
                        <button class="console-filter-chip active" data-level="DEBUG" type="button"></button>
                    </div>
                    <button id="copy-logs-btn"></button>
                    <button id="open-logs-folder-btn"></button>
                    <button id="clear-logs-btn"></button>
                </aside>
            </div>
        `;
        (globalThis as unknown as { t?: (key: string, fallback: string) => string }).t = (
            key,
            fallback,
        ) => `${key}:${fallback}`;
        showToastMock = vi.fn();
        vi.clearAllMocks();
    });

    afterEach(() => {
        ui?.destroy();
        ui = null;
        document.body.innerHTML = '';
        vi.useRealTimers();
    });

    async function flushPromises(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    }

    function createDeps() {
        return {
            eventBus: testEventBus,
            translate: (key: string, fallback: string) => `${key}:${fallback}`,
            showToast: (
                message: string,
                type?: 'success' | 'error' | 'warning' | 'info',
                duration?: number,
            ) => {
                (
                    showToastMock as (
                        message: string,
                        type?: 'success' | 'error' | 'warning' | 'info',
                        duration?: number,
                    ) => void
                )(message, type, duration);
            },
            copyText: async (text: string) => {
                await navigator.clipboard.writeText(text);
            },
        };
    }

    function createServiceMock(
        overrides: Partial<{
            init: ReturnType<typeof vi.fn>;
            destroy: ReturnType<typeof vi.fn>;
            clearLogs: ReturnType<typeof vi.fn>;
            getLogs: ReturnType<typeof vi.fn>;
            getLogsForView: ReturnType<typeof vi.fn>;
            getAvailableViews: ReturnType<typeof vi.fn>;
            getStatusItems: ReturnType<typeof vi.fn>;
            fetchLogs: ReturnType<typeof vi.fn>;
            getModulePath: ReturnType<typeof vi.fn>;
            openModuleFolder: ReturnType<typeof vi.fn>;
            openLogsFolder: ReturnType<typeof vi.fn>;
        }> = {},
    ): ConsoleLogService {
        return {
            init: vi.fn().mockResolvedValue(undefined),
            destroy: vi.fn(),
            clearLogs: vi.fn().mockResolvedValue(true),
            getLogs: vi.fn().mockReturnValue([]),
            getLogsForView: vi.fn().mockReturnValue([]),
            getAvailableViews: vi.fn().mockResolvedValue([{ id: 'general', label: 'General' }]),
            getStatusItems: vi.fn().mockResolvedValue([]),
            fetchLogs: vi.fn().mockResolvedValue([]),
            getModulePath: vi.fn().mockResolvedValue(null),
            openModuleFolder: vi.fn().mockResolvedValue(false),
            openLogsFolder: vi.fn().mockResolvedValue(false),
            ...overrides,
        } as unknown as ConsoleLogService;
    }

    function createConsoleUI(): ConsoleUI {
        return new ConsoleUI(createServiceMock(), createDeps());
    }

    it('should remove slider listeners on destroy', () => {
        ui = createConsoleUI();
        ui.init();

        const slider = document.querySelector('.debug-slider-1') as HTMLInputElement;
        const value = document.querySelector('.debug-slider-1-value') as HTMLSpanElement;

        slider.value = '42';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        expect(value.textContent).toBe('42%');

        ui.destroy();
        value.textContent = '0%';

        slider.value = '99';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        expect(value.textContent).toBe('0%');
    });

    it('should handle draggable, tabs and dropzone interactions', () => {
        vi.useFakeTimers();
        ui = createConsoleUI();
        ui.init();

        const draggable = document.querySelector('.debug-draggable') as HTMLElement;
        vi.spyOn(draggable, 'getBoundingClientRect').mockReturnValue({
            left: 10,
            top: 20,
        } as DOMRect);
        draggable.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, clientX: 30, clientY: 40 }),
        );
        document.dispatchEvent(
            new MouseEvent('mousemove', { bubbles: true, clientX: 60, clientY: 90 }),
        );
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        expect(draggable.style.left).toBe('40px');
        expect(draggable.style.top).toBe('70px');

        ui.setTab('first', document.querySelector('.debug-tab') as HTMLElement);
        expect(document.getElementById('debug-first-tab')?.classList.contains('active')).toBe(true);
        (document.querySelector('.console-tab') as HTMLElement).click();
        expect(document.getElementById('logs-general')?.classList.contains('active')).toBe(true);

        const dropzone = document.querySelector('.debug-dropzone') as HTMLElement;
        const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
        Object.defineProperty(dragOver, 'preventDefault', { value: vi.fn() });
        dropzone.dispatchEvent(dragOver);
        expect(dropzone.classList.contains('drag-over')).toBe(true);
        const drop = new Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(drop, 'preventDefault', { value: vi.fn() });
        dropzone.dispatchEvent(drop);
        expect(dropzone.textContent).toContain('dragged');
        vi.advanceTimersByTime(2000);
        expect(dropzone.textContent).toContain('drop_here');
    });

    it('should clear, copy and render logs through browser clipboard fallback', async () => {
        const service = createServiceMock({
            getLogs: vi.fn().mockReturnValue(
                normalizeLogs([
                    { level: 'INFO', message: ' hello ', source: 'system', timestamp: 1 },
                    { level: 'ERROR', message: 'boom', source: 'api-gateway', timestamp: 2 },
                ]),
            ),
            getLogsForView: vi.fn().mockReturnValue(
                normalizeLogs([
                    { level: 'INFO', message: ' hello ', source: 'system', timestamp: 1 },
                    { level: 'ERROR', message: 'boom', source: 'api-gateway', timestamp: 2 },
                ]),
            ),
            fetchLogs: vi
                .fn()
                .mockResolvedValue(
                    normalizeLogs([
                        { level: 'INFO', message: 'new', source: 'system', timestamp: 3 },
                    ]),
                ),
        });

        ui = new ConsoleUI(service, createDeps());
        const clipboardWrite = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            configurable: true,
            value: { writeText: clipboardWrite },
        });

        ui.init();
        await ui.clearLogs();
        expect(service.clearLogs).toHaveBeenCalled();

        await ui.copyLogs();
        expect(clipboardWrite).toHaveBeenCalledWith('hello\nboom');

        (service.getLogsForView as ReturnType<typeof vi.fn>).mockReturnValue([]);
        await ui.copyLogs();
        expect(showToastMock).toHaveBeenCalledWith(
            'ui.debug.logs_empty:No logs to copy',
            'warning',
            1500,
        );
    });

    it('should require a second clear action click before clearing logs', async () => {
        vi.useFakeTimers();
        const service = createServiceMock();

        ui = new ConsoleUI(service, createDeps());
        ui.init();

        const clearButton = document.getElementById('clear-logs-btn') as HTMLButtonElement;
        clearButton.click();

        expect(clearButton.classList.contains('confirming')).toBe(true);
        expect(service.clearLogs).not.toHaveBeenCalled();

        clearButton.click();
        await vi.runOnlyPendingTimersAsync();

        expect(clearButton.classList.contains('confirming')).toBe(false);
        expect(service.clearLogs).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it('should reset clear action confirmation after timeout', () => {
        vi.useFakeTimers();
        const service = createServiceMock();

        ui = new ConsoleUI(service, createDeps());
        ui.init();

        const clearButton = document.getElementById('clear-logs-btn') as HTMLButtonElement;
        clearButton.click();
        vi.advanceTimersByTime(2200);

        expect(clearButton.classList.contains('confirming')).toBe(false);
        expect(service.clearLogs).not.toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('should open logs folder from the console actions', async () => {
        const service = createServiceMock({
            openLogsFolder: vi.fn().mockResolvedValue(true),
        });

        ui = new ConsoleUI(service, createDeps());
        ui.init();

        document.getElementById('open-logs-folder-btn')?.click();
        await flushPromises();

        expect(service.openLogsFolder).toHaveBeenCalledTimes(1);
    });

    it('should scroll logs to the bottom on the first render', () => {
        vi.useFakeTimers();
        const service = createServiceMock({
            getLogs: vi
                .fn()
                .mockReturnValue(
                    normalizeLogs([
                        { level: 'INFO', message: 'alpha', source: 'system', timestamp: 1 },
                    ]),
                ),
            getLogsForView: vi
                .fn()
                .mockReturnValue(
                    normalizeLogs([
                        { level: 'INFO', message: 'alpha', source: 'system', timestamp: 1 },
                    ]),
                ),
            fetchLogs: vi
                .fn()
                .mockResolvedValue(
                    normalizeLogs([
                        { level: 'INFO', message: 'alpha', source: 'system', timestamp: 2 },
                    ]),
                ),
        });

        const container = document.getElementById('console-container') as HTMLDivElement;
        Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 720 });
        Object.defineProperty(container, 'clientHeight', { configurable: true, value: 200 });
        container.scrollTop = 0;

        ui = new ConsoleUI(service, createDeps());
        (
            ui as unknown as {
                renderLogs: (clear?: boolean) => void;
            }
        ).renderLogs();
        vi.advanceTimersByTime(100);

        expect(container.scrollTop).toBe(720);
    });

    it('should render logs at the bottom when console page becomes active', async () => {
        const service = createServiceMock({
            getLogs: vi
                .fn()
                .mockReturnValue(
                    normalizeLogs([
                        { level: 'INFO', message: 'alpha', source: 'system', timestamp: 1 },
                    ]),
                ),
            getLogsForView: vi
                .fn()
                .mockReturnValue(
                    normalizeLogs([
                        { level: 'INFO', message: 'alpha', source: 'system', timestamp: 1 },
                    ]),
                ),
            fetchLogs: vi.fn().mockResolvedValue([]),
        });

        const container = document.getElementById('console-container') as HTMLDivElement;
        Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 720 });
        Object.defineProperty(container, 'clientHeight', { configurable: true, value: 200 });
        container.scrollTop = 0;

        ui = new ConsoleUI(service, createDeps());
        ui.init();
        await (
            ui as unknown as {
                _refreshLogsOnConsoleOpen: () => Promise<void>;
            }
        )._refreshLogsOnConsoleOpen();

        expect(container.scrollTop).toBe(720);
    });

    it('should fetch logs immediately when console page becomes active', async () => {
        const service = createServiceMock();

        ui = new ConsoleUI(service, createDeps());
        ui.init();

        testEventBus.emit('page:change', { pageId: 'console' });
        await flushPromises();

        expect(service.fetchLogs).toHaveBeenCalledTimes(1);
    });

    it('should start polling only while console page is active', () => {
        const service = createServiceMock();

        document.getElementById('page-console')?.classList.remove('active');
        ui = new ConsoleUI(service, createDeps());

        const pollingController = (
            ui as unknown as {
                _pollingController: { start: (intervalMs: number) => void; stop: () => void };
            }
        )._pollingController;
        const startSpy = vi.spyOn(pollingController, 'start');
        const stopSpy = vi.spyOn(pollingController, 'stop');

        ui.init();
        expect(startSpy).not.toHaveBeenCalled();
        expect(stopSpy).toHaveBeenCalledTimes(1);

        document.getElementById('page-console')?.classList.add('active');
        testEventBus.emit('page:change', { pageId: 'console' });
        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(stopSpy).toHaveBeenCalledTimes(2);

        document.getElementById('page-console')?.classList.remove('active');
        testEventBus.emit('page:change', { pageId: 'home' });
        expect(stopSpy).toHaveBeenCalledTimes(3);
    });

    it('should render module-specific tabs and filter logs by active view', async () => {
        const service = createServiceMock({
            getLogsForView: vi.fn((view: string) =>
                normalizeLogs(
                    view === 'engine:llamacpp'
                        ? [
                              {
                                  level: 'INFO',
                                  message: 'engine line',
                                  source: 'llamacpp',
                                  timestamp: 1,
                              },
                          ]
                        : [
                              {
                                  level: 'INFO',
                                  message: 'general line',
                                  source: 'system',
                                  timestamp: 1,
                              },
                          ],
                ),
            ),
            getAvailableViews: vi.fn().mockResolvedValue([
                { id: 'general', label: 'General' },
                { id: 'engine:llamacpp', label: 'LLaMA.cpp' },
            ]),
            fetchLogs: vi.fn().mockResolvedValue([]),
        });

        ui = new ConsoleUI(service, createDeps());
        ui.init();
        await flushPromises();

        const moduleTab = document.querySelector('[data-view="engine:llamacpp"]') as HTMLElement;
        moduleTab.click();

        expect(service.getLogsForView).toHaveBeenLastCalledWith('engine:llamacpp');
        expect(document.getElementById('logs-general')?.hidden).toBe(true);
        expect(document.getElementById('logs-engine:llamacpp')?.hidden).toBe(false);
        expect(document.getElementById('logs-engine:llamacpp')?.textContent).toContain(
            'engine line',
        );
    });

    it('should expose tab scroll controls when log tabs overflow', async () => {
        const toolbar = document.querySelector('.console-toolbar-left') as HTMLElement;
        Object.defineProperty(toolbar, 'clientWidth', { configurable: true, value: 160 });
        Object.defineProperty(toolbar, 'scrollWidth', { configurable: true, value: 520 });
        toolbar.scrollBy = vi.fn(({ left }: ScrollToOptions) => {
            toolbar.scrollLeft += Number(left ?? 0);
            toolbar.dispatchEvent(new Event('scroll'));
        }) as unknown as typeof toolbar.scrollBy;

        const service = createServiceMock({
            getAvailableViews: vi.fn().mockResolvedValue([
                { id: 'general', label: 'General' },
                { id: 'module:telegram', label: 'Telegram' },
                { id: 'module:parser', label: 'Parser' },
                { id: 'engine:llamacpp', label: 'llamacpp' },
                { id: 'engine:sdcpp', label: 'sdcpp' },
            ]),
        });

        ui = new ConsoleUI(service, createDeps());
        ui.init();
        await flushPromises();

        const previousButton = document.querySelector(
            '.console-tab-scroll-left',
        ) as HTMLButtonElement;
        const nextButton = document.querySelector('.console-tab-scroll-right') as HTMLButtonElement;

        expect(previousButton.hidden).toBe(false);
        expect(previousButton.disabled).toBe(true);
        expect(nextButton.hidden).toBe(false);

        nextButton.click();

        expect(toolbar.scrollLeft).toBeGreaterThan(0);
        expect(previousButton.disabled).toBe(false);
    });

    it('should hide runtime status cards when matching log tabs already exist', async () => {
        const service = createServiceMock({
            getLogsForView: vi.fn((view: string) =>
                normalizeLogs(
                    view === 'module:axelate-telegram-bot'
                        ? [
                              {
                                  level: 'INFO',
                                  message: 'telegram runtime line',
                                  source: 'module:axelate-telegram-bot',
                                  module_id: 'axelate-telegram-bot',
                                  timestamp: 1,
                              },
                          ]
                        : [],
                ),
            ),
            getAvailableViews: vi.fn().mockResolvedValue([
                { id: 'general', label: 'General' },
                { id: 'module:axelate-telegram-bot', label: 'Telegram Bot' },
            ]),
            getStatusItems: vi.fn().mockResolvedValue([
                {
                    id: 'module:axelate-telegram-bot',
                    label: 'Telegram Bot',
                    kind: 'module',
                    status: 'running',
                    detail: 'Running',
                },
            ]),
            fetchLogs: vi.fn().mockResolvedValue([]),
        });

        ui = new ConsoleUI(service, createDeps());
        ui.init();
        await flushPromises();

        const cardsRoot = document.getElementById('console-runtime-cards') as HTMLElement;
        const card = cardsRoot.querySelector<HTMLElement>('.console-runtime-card');
        expect(cardsRoot.hidden).toBe(true);
        expect(card).toBeNull();
    });

    it('should hide idle engine status cards', async () => {
        const service = createServiceMock({
            getAvailableViews: vi.fn().mockResolvedValue([{ id: 'general', label: 'General' }]),
            getStatusItems: vi.fn().mockResolvedValue([
                {
                    id: 'engine:idle',
                    label: 'Engines',
                    kind: 'engine',
                    status: 'stopped',
                    detail: 'No active engines',
                },
            ]),
        });

        ui = new ConsoleUI(service, createDeps());
        ui.init();
        await flushPromises();

        const cardsRoot = document.getElementById('console-runtime-cards') as HTMLElement;
        expect(cardsRoot.hidden).toBe(true);
        expect(cardsRoot.textContent).not.toContain('No active engines');
    });

    it('should copy only logs from the active view', async () => {
        const clipboardWrite = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            configurable: true,
            value: { writeText: clipboardWrite },
        });

        const service = createServiceMock({
            getLogsForView: vi.fn((view: string) =>
                normalizeLogs(
                    view === 'engine:llamacpp'
                        ? [
                              {
                                  level: 'INFO',
                                  message: 'engine line',
                                  source: 'llamacpp',
                                  timestamp: 1,
                              },
                          ]
                        : [
                              {
                                  level: 'INFO',
                                  message: 'general line',
                                  source: 'system',
                                  timestamp: 1,
                              },
                          ],
                ),
            ),
            getAvailableViews: vi.fn().mockResolvedValue([
                { id: 'general', label: 'General' },
                { id: 'engine:llamacpp', label: 'LLaMA.cpp' },
            ]),
        });

        ui = new ConsoleUI(service, createDeps());
        ui.init();
        await flushPromises();

        const moduleTab = document.querySelector('[data-view="engine:llamacpp"]') as HTMLElement;
        moduleTab.click();
        await ui.copyLogs();

        const copiedText = clipboardWrite.mock.calls[0]?.[0] as string;
        expect(copiedText).toContain('engine line');
        expect(copiedText).not.toContain('general line');
    });

    it('should group repeated manifest errors without expandable details', async () => {
        const logs = normalizeLogs([
            {
                level: 'INFO',
                message: '[AIBridge] Starting provider: llamacpp',
                source: 'frontend',
                timestamp: 1,
            },
            {
                level: 'ERROR',
                message:
                    '[ModuleService] Control failed: Error: Manifest not found. Expected axelate-module.toml',
                source: 'frontend',
                timestamp: 2,
            },
            {
                level: 'ERROR',
                message:
                    '[ModuleService] Control failed: Error: Manifest not found. Expected axelate-module.toml',
                source: 'frontend',
                timestamp: 3,
            },
        ]);
        const service = createServiceMock({
            getLogsForView: vi.fn().mockReturnValue(logs),
        });

        ui = new ConsoleUI(service, createDeps());
        ui.init();
        await (
            ui as unknown as {
                _refreshLogsOnConsoleOpen: () => Promise<void>;
            }
        )._refreshLogsOnConsoleOpen();
        await flushPromises();

        const badge = document.querySelector('.log-count-badge') as HTMLSpanElement | null;
        expect(badge?.textContent).toBe('x2');

        const errorEntry = document.querySelectorAll('.log-entry')[1] as HTMLDivElement;
        errorEntry.click();
        await flushPromises();

        expect(errorEntry.getAttribute('role')).toBeNull();
        expect(document.querySelector('.log-entry-details')).toBeNull();
    });

    it('should not wipe rendered logs when views are unchanged and no new logs arrived', async () => {
        const service = createServiceMock({
            getLogsForView: vi
                .fn()
                .mockReturnValue(
                    normalizeLogs([
                        { level: 'INFO', message: 'stable line', source: 'system', timestamp: 1 },
                    ]),
                ),
            fetchLogs: vi.fn().mockResolvedValue([]),
        });

        ui = new ConsoleUI(service, createDeps());
        ui.init();
        await (
            ui as unknown as {
                _refreshLogsOnConsoleOpen: () => Promise<void>;
            }
        )._refreshLogsOnConsoleOpen();

        expect(document.getElementById('logs-general')?.textContent).toContain('stable line');

        await (
            ui as unknown as {
                refreshLogViews: () => Promise<boolean>;
            }
        ).refreshLogViews();

        expect(document.getElementById('logs-general')?.textContent).toContain('stable line');
    });

    it('should isolate logs by selected level and restore all levels on repeat click', async () => {
        const service = createServiceMock({
            getLogsForView: vi.fn().mockReturnValue(
                normalizeLogs([
                    {
                        level: 'INFO',
                        message: '[NavigationService] Navigating to: settings',
                        source: 'frontend',
                        timestamp: 1,
                    },
                    {
                        level: 'ERROR',
                        message:
                            '[ModuleService] Control failed: Error: Manifest not found. Expected axelate-module.toml',
                        source: 'frontend',
                        timestamp: 2,
                    },
                ]),
            ),
        });

        ui = new ConsoleUI(service, createDeps());
        ui.init();
        await (
            ui as unknown as {
                _refreshLogsOnConsoleOpen: () => Promise<void>;
            }
        )._refreshLogsOnConsoleOpen();
        await flushPromises();

        expect(document.getElementById('logs-general')?.textContent).toContain(
            'Manifest not found',
        );
        expect(document.getElementById('logs-general')?.textContent).toContain('Page settings');

        const infoButton = document.querySelector(
            '.console-filter-chip[data-level="INFO"]',
        ) as HTMLButtonElement;
        infoButton.click();

        expect(document.getElementById('logs-general')?.textContent).toContain('Page settings');
        expect(document.getElementById('logs-general')?.textContent).not.toContain(
            'Manifest not found',
        );

        infoButton.click();

        expect(document.getElementById('logs-general')?.textContent).toContain(
            'Manifest not found',
        );
        expect(document.getElementById('logs-general')?.textContent).toContain('Page settings');
    });

    it('should allow multi-select level filters with ctrl click', async () => {
        const service = createServiceMock({
            getLogsForView: vi.fn().mockReturnValue(
                normalizeLogs([
                    {
                        level: 'INFO',
                        message: '[NavigationService] Navigating to: settings',
                        source: 'frontend',
                        timestamp: 1,
                    },
                    {
                        level: 'ERROR',
                        message:
                            '[ModuleService] Control failed: Error: Manifest not found. Expected axelate-module.toml',
                        source: 'frontend',
                        timestamp: 2,
                    },
                    {
                        level: 'DEBUG',
                        message: '[NavigationUI] Page modules',
                        source: 'frontend',
                        timestamp: 3,
                    },
                ]),
            ),
        });

        ui = new ConsoleUI(service, createDeps());
        ui.init();
        await (
            ui as unknown as {
                _refreshLogsOnConsoleOpen: () => Promise<void>;
            }
        )._refreshLogsOnConsoleOpen();
        await flushPromises();

        const errorButton = document.querySelector(
            '.console-filter-chip[data-level="ERROR"]',
        ) as HTMLButtonElement;
        const infoButton = document.querySelector(
            '.console-filter-chip[data-level="INFO"]',
        ) as HTMLButtonElement;

        errorButton.click();

        expect(document.getElementById('logs-general')?.textContent).toContain(
            'Manifest not found',
        );
        expect(document.getElementById('logs-general')?.textContent).not.toContain('Page settings');
        expect(document.getElementById('logs-general')?.textContent).not.toContain('Page modules');

        infoButton.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));

        expect(document.getElementById('logs-general')?.textContent).toContain(
            'Manifest not found',
        );
        expect(document.getElementById('logs-general')?.textContent).toContain('Page settings');
        expect(document.getElementById('logs-general')?.textContent).not.toContain('Page modules');
    });

    it('should hide launcher source labels like frontend from rendered logs', async () => {
        const service = createServiceMock({
            getLogsForView: vi.fn().mockReturnValue(
                normalizeLogs([
                    {
                        level: 'INFO',
                        message: '[NavigationService] Navigating to: settings',
                        source: 'frontend',
                        timestamp: 1,
                    },
                ]),
            ),
        });

        ui = new ConsoleUI(service, createDeps());
        await (
            ui as unknown as {
                _refreshLogsOnConsoleOpen: () => Promise<void>;
            }
        )._refreshLogsOnConsoleOpen();
        await flushPromises();

        expect(document.querySelector('.log-src')).toBeNull();
        expect(document.getElementById('logs-general')?.textContent).toContain('Page settings');
    });
});
