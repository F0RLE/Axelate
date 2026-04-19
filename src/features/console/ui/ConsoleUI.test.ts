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
                <div class="console-toolbar-left">
                    <button class="console-tab" data-view="general"></button>
                </div>
                <div class="console-toolbar-right">
                    <div class="console-level-filters">
                        <button class="console-filter-chip active" data-level="ERROR" type="button"></button>
                        <button class="console-filter-chip active" data-level="WARN" type="button"></button>
                        <button class="console-filter-chip active" data-level="INFO" type="button"></button>
                        <button class="console-filter-chip active" data-level="DEBUG" type="button"></button>
                    </div>
                    <button id="copy-logs-btn"></button>
                    <button id="clear-logs-btn"></button>
                </div>
            </div>
            <div id="page-console" class="active"></div>
            <div id="console-container" class="console-logs-area">
                <div id="logs">
                    <div id="logs-general" class="logs-pane active"></div>
                </div>
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
            fetchLogs: ReturnType<typeof vi.fn>;
            getModulePath: ReturnType<typeof vi.fn>;
            openModuleFolder: ReturnType<typeof vi.fn>;
        }> = {},
    ): ConsoleLogService {
        return {
            init: vi.fn().mockResolvedValue(undefined),
            destroy: vi.fn(),
            clearLogs: vi.fn().mockResolvedValue(true),
            getLogs: vi.fn().mockReturnValue([]),
            getLogsForView: vi.fn().mockReturnValue([]),
            getAvailableViews: vi.fn().mockResolvedValue([{ id: 'general', label: 'General' }]),
            fetchLogs: vi.fn().mockResolvedValue([]),
            getModulePath: vi.fn().mockResolvedValue(null),
            openModuleFolder: vi.fn().mockResolvedValue(false),
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
        vi.useFakeTimers();
        const service = createServiceMock({
            getLogs: vi.fn().mockReturnValue(normalizeLogs([
                { level: 'INFO', message: ' hello ', source: 'system', timestamp: 1 },
                { level: 'ERROR', message: 'boom', source: 'api-gateway', timestamp: 2 },
            ])),
            getLogsForView: vi.fn().mockReturnValue(normalizeLogs([
                { level: 'INFO', message: ' hello ', source: 'system', timestamp: 1 },
                { level: 'ERROR', message: 'boom', source: 'api-gateway', timestamp: 2 },
            ])),
            fetchLogs: vi.fn().mockResolvedValue(normalizeLogs([{ level: 'INFO', message: 'new', source: 'system', timestamp: 3 }])),
        });

        ui = new ConsoleUI(service, createDeps());
        const clipboardWrite = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            configurable: true,
            value: { writeText: clipboardWrite },
        });

        ui.init();
        await ui.clearLogs();
        vi.advanceTimersByTime(100);
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

    it('should scroll logs to the bottom on the first render', () => {
        const service = createServiceMock({
            getLogs: vi
                .fn()
                .mockReturnValue(normalizeLogs([
                    { level: 'INFO', message: 'alpha', source: 'system', timestamp: 1 },
                ])),
            getLogsForView: vi
                .fn()
                .mockReturnValue(normalizeLogs([
                    { level: 'INFO', message: 'alpha', source: 'system', timestamp: 1 },
                ])),
            fetchLogs: vi.fn().mockResolvedValue(normalizeLogs([{ level: 'INFO', message: 'alpha', source: 'system', timestamp: 2 }])),
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
                .mockReturnValue(normalizeLogs([
                    { level: 'INFO', message: 'alpha', source: 'system', timestamp: 1 },
                ])),
            getLogsForView: vi
                .fn()
                .mockReturnValue(normalizeLogs([
                    { level: 'INFO', message: 'alpha', source: 'system', timestamp: 1 },
                ])),
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

    it('should render module-specific tabs and filter logs by active view', async () => {
        const service = createServiceMock({
            getLogsForView: vi.fn((view: string) =>
                normalizeLogs(
                    view === 'llamacpp'
                        ? [{ level: 'INFO', message: 'engine line', source: 'llamacpp', timestamp: 1 }]
                        : [{ level: 'INFO', message: 'general line', source: 'system', timestamp: 1 }],
                ),
            ),
            getAvailableViews: vi.fn().mockResolvedValue([
                { id: 'general', label: 'General' },
                { id: 'llamacpp', label: 'LLaMA.cpp' },
            ]),
            fetchLogs: vi.fn().mockResolvedValue([]),
        });

        ui = new ConsoleUI(service, createDeps());
        ui.init();
        await flushPromises();

        const moduleTab = document.querySelector('[data-view="llamacpp"]') as HTMLElement;
        moduleTab.click();

        expect(service.getLogsForView).toHaveBeenLastCalledWith('llamacpp');
        expect(document.getElementById('logs-general')?.hidden).toBe(true);
        expect(document.getElementById('logs-llamacpp')?.hidden).toBe(false);
        expect(document.getElementById('logs-llamacpp')?.textContent).toContain('engine line');
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
                    view === 'llamacpp'
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
                { id: 'llamacpp', label: 'LLaMA.cpp' },
            ]),
        });

        ui = new ConsoleUI(service, createDeps());
        ui.init();
        await flushPromises();

        const moduleTab = document.querySelector('[data-view="llamacpp"]') as HTMLElement;
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
                .mockReturnValue(normalizeLogs([
                    { level: 'INFO', message: 'stable line', source: 'system', timestamp: 1 },
                ])),
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

    it('should filter logs by selected levels from top menu', async () => {
        const service = createServiceMock({
            getLogsForView: vi.fn().mockReturnValue(normalizeLogs([
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
            ])),
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

        expect(document.getElementById('logs-general')?.textContent).toContain(
            'Manifest not found',
        );
        expect(document.getElementById('logs-general')?.textContent).not.toContain('Page settings');
    });

    it('should hide launcher source labels like frontend from rendered logs', async () => {
        const service = createServiceMock({
            getLogsForView: vi.fn().mockReturnValue(normalizeLogs([
                {
                    level: 'INFO',
                    message: '[NavigationService] Navigating to: settings',
                    source: 'frontend',
                    timestamp: 1,
                },
            ])),
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
