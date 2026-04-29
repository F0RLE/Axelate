/**
 * DownloadUI Unit Tests — Full Coverage
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DownloadUI } from './DownloadUI';
import type { I18nService } from '@/infrastructure/i18n/I18nService';

function setupDOM() {
    document.body.innerHTML = `
        <div id="page-downloads"></div>
        <div id="downloads-main-card" class="hidden"></div>
        <div id="downloads-empty-text"></div>
        <div id="downloads-progress-bar"></div>
        <div id="downloads-progress-text"></div>
        <div id="downloads-speed"></div>
        <div id="downloads-downloaded"></div>
        <div id="downloads-total"></div>
        <div id="downloads-item-label"></div>
        <div id="downloads-status"></div>
        <div id="downloads-eta"></div>
        <div id="downloads-body"></div>
        <div class="downloads-header"></div>
        <div id="downloads-container"></div>
    `;
}

function createMocks() {
    const i18nService = {
        t: vi.fn((_key: string, def?: string) => def ?? _key),
    } as unknown as I18nService;

    return { i18nService };
}

describe('DownloadUI', () => {
    let ui: DownloadUI;
    let i18nService: I18nService;

    beforeEach(() => {
        vi.useFakeTimers();
        setupDOM();
        const mocks = createMocks();
        i18nService = mocks.i18nService;
        ui = new DownloadUI(i18nService);
    });

    afterEach(() => {
        ui.destroy();
        vi.useRealTimers();
        vi.clearAllMocks();
        document.body.innerHTML = '';
    });

    // ---------------------------------------------------------- init
    describe('init', () => {
        it('should initialize polling listeners', () => {
            ui.init();
            // Should register event listener for download-progress-update
            const mainCard = document.getElementById('downloads-main-card');
            expect(mainCard?.classList.contains('hidden')).toBe(true);
        });
    });

    // ---------------------------------------------------------- setOnCancel
    describe('setOnCancel', () => {
        it('should set cancel callback', () => {
            const cancelFn = vi.fn();
            ui.setOnCancel(cancelFn);
            // Stored internally — tested via dynamic card cancel button
        });

        it('should set pause and resume callbacks', () => {
            ui.setOnPause(vi.fn());
            ui.setOnResume(vi.fn());
        });
    });

    // ---------------------------------------------------------- destroy
    describe('destroy', () => {
        it('should remove event listener', () => {
            const removeEventListener = vi.fn();
            const setTimeoutMock = vi.fn((callback: () => void, delay?: number) =>
                globalThis.setTimeout(callback, delay),
            ) as unknown as typeof globalThis.setTimeout;
            const clearTimeoutMock = vi.fn((handle?: ReturnType<typeof setTimeout>) => {
                if (handle !== undefined) {
                    globalThis.clearTimeout(handle);
                }
            }) as unknown as typeof globalThis.clearTimeout;
            ui = new DownloadUI(i18nService, {
                addEventListener: vi.fn(),
                removeEventListener,
                setTimeout: setTimeoutMock,
                clearTimeout: clearTimeoutMock,
            });
            ui.init();
            ui.destroy();
            expect(removeEventListener).toHaveBeenCalledWith(
                'download-progress-update',
                expect.any(Function),
            );
            expect(removeEventListener).toHaveBeenCalledWith(
                'language-changed',
                expect.any(Function),
            );
        });

        it('should be safe to call without init', () => {
            ui.destroy(); // No listener set, should not throw
        });

        it('should cancel pending terminal cleanup timers on destroy', () => {
            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-destroy',
                        progress: 1,
                        status: 'complete',
                    },
                }),
            );

            ui.destroy();
            vi.advanceTimersByTime(2100);

            const list = document.getElementById('downloads-dynamic-list');
            expect(list?.querySelectorAll('.download-item-card').length).toBe(1);
        });
    });

    // ---------------------------------------------------------- renderDownloadsProgress basics
    describe('renderDownloadsProgress', () => {
        it('should toggle active-download on the page shell', () => {
            ui.renderDownloadsProgress({ hasActive: true, label: 'Test Download' });

            expect(
                document.getElementById('page-downloads')?.classList.contains('active-download'),
            ).toBe(true);

            ui.renderDownloadsProgress({ hasActive: false });

            expect(
                document.getElementById('page-downloads')?.classList.contains('active-download'),
            ).toBe(false);
        });

        it('should render progress bar and text', () => {
            ui.renderDownloadsProgress({
                percent: 50,
                hasActive: true,
                speed: 1024 * 1024,
                downloaded: 50 * 1024 * 1024,
                total: 100 * 1024 * 1024,
                label: 'Test Download',
            });

            const bar = document.getElementById('downloads-progress-bar');
            const text = document.getElementById('downloads-progress-text');
            const speed = document.getElementById('downloads-speed');

            expect(bar?.style.width).toBe('50%');
            expect(text?.textContent).toBe('50.0%');
            expect(speed?.textContent).toBe('1.00 MB/s');
        });

        it('should hide main card and show empty state when no active download', () => {
            ui.renderDownloadsProgress({ hasActive: false });

            const mainCard = document.getElementById('downloads-main-card');
            const emptyText = document.getElementById('downloads-empty-text');

            expect(mainCard?.classList.contains('hidden')).toBe(true);
            expect(emptyText?.classList.contains('hidden')).toBe(false);
        });

        it('should show indeterminate progress for negative percent', () => {
            ui.renderDownloadsProgress({
                percent: -1,
                hasActive: true,
                label: 'Connecting',
            });

            const bar = document.getElementById('downloads-progress-bar');
            const text = document.getElementById('downloads-progress-text');

            expect(bar?.style.width).toBe('100%');
            expect(bar?.classList.contains('indeterminate-bar')).toBe(true);
            expect(text?.textContent).toBe('--%');
        });

        it('should show progress visuals with defaults', () => {
            ui.renderDownloadsProgress({});

            const text = document.getElementById('downloads-progress-text');
            expect(text?.textContent).toBe('0.0%');
        });
    });

    // ---------------------------------------------------------- formatSpeed
    describe('formatSpeed (via renderDownloadsProgress)', () => {
        it('should format speed in MB/s', () => {
            ui.renderDownloadsProgress({ speed: 2 * 1024 * 1024, hasActive: true, label: 'x' });
            expect(document.getElementById('downloads-speed')?.textContent).toBe('2.00 MB/s');
        });

        it('should format speed in KB/s', () => {
            ui.renderDownloadsProgress({ speed: 512 * 1024, hasActive: true, label: 'x' });
            expect(document.getElementById('downloads-speed')?.textContent).toBe('512.0 KB/s');
        });

        it('should format speed in B/s', () => {
            ui.renderDownloadsProgress({ speed: 500, hasActive: true, label: 'x' });
            expect(document.getElementById('downloads-speed')?.textContent).toBe('500 B/s');
        });
    });

    // ---------------------------------------------------------- formatBytes
    describe('formatBytes (via renderDownloadsProgress)', () => {
        it('should format bytes in GB', () => {
            ui.renderDownloadsProgress({
                downloaded: 2 * 1024 * 1024 * 1024,
                hasActive: true,
                label: 'x',
            });
            expect(document.getElementById('downloads-downloaded')?.textContent).toBe('2.00 GB');
        });

        it('should format bytes in MB', () => {
            ui.renderDownloadsProgress({
                downloaded: 150 * 1024 * 1024,
                hasActive: true,
                label: 'x',
            });
            expect(document.getElementById('downloads-downloaded')?.textContent).toBe('150.00 MB');
        });

        it('should format bytes in KB', () => {
            ui.renderDownloadsProgress({ downloaded: 512 * 1024, hasActive: true, label: 'x' });
            expect(document.getElementById('downloads-downloaded')?.textContent).toBe('512.0 KB');
        });

        it('should format bytes in B', () => {
            ui.renderDownloadsProgress({ downloaded: 100, hasActive: true, label: 'x' });
            expect(document.getElementById('downloads-downloaded')?.textContent).toBe('100 B');
        });

        it('should show -- for total when 0', () => {
            ui.renderDownloadsProgress({ total: 0, hasActive: true, label: 'x' });
            expect(document.getElementById('downloads-total')?.textContent).toBe('--');
        });
    });

    // ---------------------------------------------------------- status updates
    describe('status updates', () => {
        it('should show "Completed" status', () => {
            ui.renderDownloadsProgress({ completed: true, label: 'Done' });
            const status = document.getElementById('downloads-status');
            expect(status?.textContent).toBe('Completed');
            expect(status?.classList.contains('completed')).toBe(true);
        });

        it('should show "Error" status', () => {
            ui.renderDownloadsProgress({ error: 'Network failure', label: 'Fail' });
            const status = document.getElementById('downloads-status');
            expect(status?.textContent).toBe('Error');
            expect(status?.classList.contains('error')).toBe(true);
        });

        it('should show "In Progress" status', () => {
            ui.renderDownloadsProgress({ hasActive: true, label: 'Downloading' });
            const status = document.getElementById('downloads-status');
            expect(status?.textContent).toBe('In Progress');
            expect(status?.classList.contains('active')).toBe(true);
        });

        it('should show "Waiting" status', () => {
            ui.renderDownloadsProgress({ hasActive: false });
            const status = document.getElementById('downloads-status');
            expect(status?.textContent).toBe('Waiting');
        });
    });

    // ---------------------------------------------------------- ETA updates
    describe('ETA updates', () => {
        it('should show "Ready" when completed', () => {
            ui.renderDownloadsProgress({ completed: true, label: 'Done' });
            expect(document.getElementById('downloads-eta')?.textContent).toBe('Ready');
        });

        it('should show error message as ETA', () => {
            ui.renderDownloadsProgress({ error: 'Connection lost', label: 'Fail' });
            expect(document.getElementById('downloads-eta')?.textContent).toBe('Connection lost');
        });

        it('should calculate ETA in seconds', () => {
            ui.renderDownloadsProgress({
                speed: 1024 * 1024,
                total: 30 * 1024 * 1024,
                downloaded: 0,
                hasActive: true,
                label: 'Test',
            });
            // 30MB / 1MB/s = 30s
            expect(document.getElementById('downloads-eta')?.textContent).toBe('30s');
        });

        it('should calculate ETA in minutes and seconds', () => {
            ui.renderDownloadsProgress({
                speed: 1024 * 1024,
                total: 90 * 1024 * 1024,
                downloaded: 0,
                hasActive: true,
                label: 'Test',
            });
            // 90MB / 1MB/s = 90s = 1m 30s
            expect(document.getElementById('downloads-eta')?.textContent).toBe('1m 30s');
        });

        it('should show -- when no speed or total', () => {
            ui.renderDownloadsProgress({ speed: 0, total: 0, hasActive: true, label: 'Test' });
            expect(document.getElementById('downloads-eta')?.textContent).toBe('--');
        });
    });

    // ---------------------------------------------------------- label updates
    describe('label updates', () => {
        it('should show fallback text when inactive and no label', () => {
            ui.renderDownloadsProgress({ hasActive: false });
            const label = document.getElementById('downloads-item-label');
            expect(label?.textContent).toBe('No active downloads');
        });

        it('should show label when active', () => {
            ui.renderDownloadsProgress({ hasActive: true, label: 'Module X' });
            const label = document.getElementById('downloads-item-label');
            expect(label?.textContent).toBe('Module X');
        });
    });

    // ---------------------------------------------------------- renderDownloadsProgress eta null
    describe('renderDownloadsProgress without etaEl', () => {
        it('should skip ETA update when eta element is missing (L288 false)', () => {
            document.getElementById('downloads-eta')?.remove();
            ui.renderDownloadsProgress({
                hasActive: true,
                percent: 50,
                completed: true, // triggers _updateEta(els, state) → if (!els.etaEl) return
            });
        });
    });

    // ---------------------------------------------------------- bindDownloadProgressEvents null element guards
    describe('bindDownloadProgressEvents without mainCard/emptyText', () => {
        it.each([
            ['mainCard', 'downloads-main-card'],
            ['emptyText', 'downloads-empty-text'],
        ])('should handle missing %s in bindDownloadProgressEvents init path', (_, id) => {
            document.getElementById(id)?.remove();
            ui.init();
        });
    });

    // ---------------------------------------------------------- error event with no error field (L364 || branch)
    describe('error event unknown error branch', () => {
        it('should use Unknown error fallback when error field is missing/empty (L364)', () => {
            ui.init();
            // Dispatch error status without an error string → triggers `|| 'Unknown error'`
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-noerrfield',
                        progress: 0.3,
                        status: 'error',
                        // no 'error' field — falsy → 'Unknown error'
                    },
                }),
            );
            const status = document.getElementById('downloads-status');
            expect(status?.textContent).toBe('Error');
        });
    });

    // ---------------------------------------------------------- null guard branches
    describe('null guard branches', () => {
        it('should handle missing emptyText in download complete cleanup', () => {
            ui.init();
            document.getElementById('downloads-empty-text')?.remove();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-et', progress: 0.5, status: 'downloading' },
                }),
            );
            // Complete → _activeDownloads becomes 0 → _renderDynamicList hits emptyText null branch
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-et', progress: 1, status: 'complete' },
                }),
            );
            vi.advanceTimersByTime(2100);
        });

        it('should handle missing mainCard in dynamic list render', () => {
            ui.init();
            document.getElementById('downloads-main-card')?.remove();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-mc', progress: 0.5, status: 'downloading' },
                }),
            );
            // mainCard is null → style.display assignment is skipped
        });

        it('should handle missing downloads-body in _ensureDynamicList', () => {
            document.getElementById('downloads-body')?.remove();
            ui.init();
            // Dispatching triggers _ensureDynamicList → body is null → early return
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-nb', progress: 0.5, status: 'downloading' },
                }),
            );
            // Should not throw
        });

        it.each([
            [
                'pctEl, statValues, or itemLabel',
                'mod-gut',
                0.9,
                'downloading',
                'Updated',
                (card: Element | null | undefined) => {
                    card?.querySelector('.downloads-progress-percent')?.remove();
                    card?.querySelectorAll('.downloads-stat-value').forEach((el) => el.remove());
                    card?.querySelector('.downloads-item-label')?.remove();
                },
            ],
            [
                'bar element',
                'mod-nobar',
                0.7,
                'downloading',
                undefined,
                (card: Element | null | undefined) => {
                    card?.querySelector('.downloads-bar-inner')?.remove();
                },
            ],
            [
                'status pill',
                'mod-nopill',
                0.7,
                'complete',
                undefined,
                (card: Element | null | undefined) => {
                    card?.querySelector('.downloads-status-pill')?.remove();
                },
            ],
        ])(
            'should handle patching a card without %s',
            (_, modId, endPct, endStatus, endMsg, removeFn) => {
                ui.init();

                globalThis.dispatchEvent(
                    new CustomEvent('download-progress-update', {
                        detail: { module_id: modId, progress: 0.3, status: 'downloading' },
                    }),
                );

                const list = document.getElementById('downloads-dynamic-list');
                const card = list?.querySelector('.download-item-card');
                removeFn(card);

                globalThis.dispatchEvent(
                    new CustomEvent('download-progress-update', {
                        detail: {
                            module_id: modId,
                            progress: endPct,
                            status: endStatus,
                            message: endMsg,
                        },
                    }),
                );
            },
        );
    });

    // ---------------------------------------------------------- bindDownloadProgressEvents event handling
    describe('bindDownloadProgressEvents', () => {
        it('should handle download progress events', () => {
            ui.init();

            const event = new CustomEvent('download-progress-update', {
                detail: {
                    module_id: 'mod-1',
                    progress: 0.5,
                    downloaded: 50,
                    total: 100,
                    status: 'downloading',
                    message: 'Downloading mod-1',
                    speed: 2048,
                },
            });
            globalThis.dispatchEvent(event);

            const label = document.getElementById('downloads-item-label');
            expect(label?.textContent).toContain('Downloading mod-1');
            expect(document.getElementById('downloads-speed')?.textContent).toBe('2.0 KB/s');
        });

        it('should ignore events without module_id', () => {
            ui.init();

            const event = new CustomEvent('download-progress-update', {
                detail: {
                    progress: 0.5,
                    status: 'downloading',
                },
            });
            globalThis.dispatchEvent(event);

            // Should not crash
        });

        it('should handle complete status and cleanup after 2s', () => {
            ui.init();

            const event = new CustomEvent('download-progress-update', {
                detail: {
                    module_id: 'mod-1',
                    progress: 1,
                    downloaded: 100,
                    total: 100,
                    status: 'complete',
                    message: 'Done',
                },
            });
            globalThis.dispatchEvent(event);

            // Advance past the 2s cleanup delay
            vi.advanceTimersByTime(2100);
        });

        it('should handle error status', () => {
            ui.init();

            const event = new CustomEvent('download-progress-update', {
                detail: {
                    module_id: 'mod-1',
                    progress: 0.3,
                    status: 'error',
                    error: 'Network failure',
                },
            });
            globalThis.dispatchEvent(event);

            const status = document.getElementById('downloads-status');
            expect(status?.textContent).toBe('Error');
        });

        it('should handle cancelled status', () => {
            ui.init();

            const event = new CustomEvent('download-progress-update', {
                detail: {
                    module_id: 'mod-1',
                    progress: 0.2,
                    status: 'cancelled',
                },
            });
            globalThis.dispatchEvent(event);

            // Should not crash, setTimeout scheduled for cleanup
            vi.advanceTimersByTime(2100);
        });

        it('should handle connecting and extracting statuses', () => {
            ui.init();

            for (const status of ['connecting', 'extracting']) {
                const event = new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: `mod-${status}`,
                        progress: 0.1,
                        status,
                        message: status,
                    },
                });
                globalThis.dispatchEvent(event);
            }
        });

        it('should localize generic backend progress messages', () => {
            (i18nService.t as ReturnType<typeof vi.fn>).mockImplementation(
                (key: string, def?: string) => {
                    if (key === 'ui.downloads.status.in_progress') return 'Загрузка';
                    return def ?? key;
                },
            );

            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-i18n',
                        progress: 0.2,
                        status: 'downloading',
                        message: 'Downloading...',
                    },
                }),
            );

            expect(document.getElementById('downloads-item-label')?.textContent).toBe('Загрузка');
        });
    });

    // ---------------------------------------------------------- Dynamic multi-download list
    describe('dynamic card rendering', () => {
        it('should render a download card when event fires', () => {
            ui.init();

            const event = new CustomEvent('download-progress-update', {
                detail: {
                    module_id: 'mod-abc',
                    progress: 0.3,
                    downloaded: 30 * 1024 * 1024,
                    total: 100 * 1024 * 1024,
                    status: 'downloading',
                    message: 'Downloading module',
                },
            });
            globalThis.dispatchEvent(event);

            const list = document.getElementById('downloads-dynamic-list');
            const card = list?.querySelector<HTMLElement>('.download-item-card');
            expect(card).not.toBeNull();
            expect(card?.dataset['moduleId']).toBe('mod-abc');
        });

        it('should render per-module speed instead of hardcoded zero', () => {
            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-speed',
                        progress: 0.3,
                        downloaded: 30 * 1024 * 1024,
                        total: 100 * 1024 * 1024,
                        speed: 3 * 1024 * 1024,
                        status: 'downloading',
                        message: 'Downloading module',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            const statValues = list?.querySelectorAll('.downloads-stat-value');
            expect(statValues?.[2]?.textContent).toBe('3.00 MB/s');
        });

        it('should patch existing card on update', () => {
            ui.init();

            // First event creates card
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-x',
                        progress: 0.2,
                        status: 'downloading',
                        message: 'Step 1',
                    },
                }),
            );

            // Second event patches
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-x',
                        progress: 0.8,
                        status: 'downloading',
                        message: 'Step 2',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            const cards = list?.querySelectorAll('.download-item-card');
            expect(cards?.length).toBe(1); // Same card, not duplicated
        });

        it('should handle indeterminate progress in card', () => {
            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-indet',
                        progress: -1,
                        status: 'connecting',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            const card = list?.querySelector('.download-item-card');
            const bar = card?.querySelector('.downloads-bar-inner');
            expect(bar?.classList.contains('indeterminate-bar')).toBe(true);
        });

        it('should wire cancel button on downloading card', () => {
            const cancelFn = vi.fn();
            ui.setOnCancel(cancelFn);
            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-cancel',
                        progress: 0.5,
                        status: 'downloading',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            const cancelBtn = list?.querySelector('.download-cancel-btn');
            expect(cancelBtn).not.toBeNull();

            if (cancelBtn !== null) (cancelBtn as HTMLElement).click();
            expect(cancelFn).toHaveBeenCalledWith('mod-cancel');
        });

        it('should wire pause button on downloading card', () => {
            const pauseFn = vi.fn();
            ui.setOnPause(pauseFn);
            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-pause',
                        progress: 0.4,
                        status: 'downloading',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            const pauseBtn = list?.querySelector('.download-pause-btn');
            expect(pauseBtn).not.toBeNull();

            if (pauseBtn !== null) (pauseBtn as HTMLElement).click();
            expect(pauseFn).toHaveBeenCalledWith('mod-pause');
        });

        it('should keep action buttons stable while progress updates', () => {
            const pauseFn = vi.fn();
            ui.setOnPause(pauseFn);
            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-stable-actions',
                        progress: 0.4,
                        status: 'downloading',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            const pauseBtn = list?.querySelector('.download-pause-btn');
            expect(pauseBtn).not.toBeNull();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-stable-actions',
                        progress: 0.42,
                        status: 'downloading',
                    },
                }),
            );

            expect(list?.querySelector('.download-pause-btn')).toBe(pauseBtn);
            if (pauseBtn !== null) (pauseBtn as HTMLElement).click();
            expect(pauseFn).toHaveBeenCalledWith('mod-stable-actions');
        });

        it('should wire resume button on paused card', () => {
            const resumeFn = vi.fn();
            ui.setOnResume(resumeFn);
            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-resume',
                        progress: 0.4,
                        status: 'paused',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            const resumeBtn = list?.querySelector('.download-resume-btn');
            expect(resumeBtn).not.toBeNull();

            if (resumeBtn !== null) (resumeBtn as HTMLElement).click();
            expect(resumeFn).toHaveBeenCalledWith('mod-resume');
        });

        it('should not add cancel button for complete status', () => {
            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-done',
                        progress: 1,
                        status: 'complete',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            const cancelBtn = list?.querySelector('.download-cancel-btn');
            expect(cancelBtn).toBeNull();
        });

        it('should remove cards for finished downloads after delay', () => {
            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-remove',
                        progress: 1,
                        status: 'complete',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            expect(list?.querySelectorAll('.download-item-card').length).toBe(1);

            // After 2s cleanup
            vi.advanceTimersByTime(2100);

            expect(list?.querySelectorAll('.download-item-card').length).toBe(0);
        });

        it('should return downloads layout to empty state after final cleanup', () => {
            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-final',
                        progress: 0.4,
                        status: 'downloading',
                    },
                }),
            );

            expect(
                document
                    .getElementById('downloads-container')
                    ?.classList.contains('active-download'),
            ).toBe(true);

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-final',
                        progress: 1,
                        status: 'complete',
                    },
                }),
            );

            vi.advanceTimersByTime(2100);

            expect(
                document
                    .getElementById('downloads-container')
                    ?.classList.contains('active-download'),
            ).toBe(false);
            expect(
                document.getElementById('downloads-body')?.classList.contains('empty-state'),
            ).toBe(true);
            expect(
                document.getElementById('downloads-empty-text')?.classList.contains('hidden'),
            ).toBe(false);
            expect(document.getElementById('downloads-item-label')?.textContent).toBe(
                'No active downloads',
            );
        });

        it('should cancel stale terminal cleanup when the same module restarts downloading', () => {
            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-retry',
                        progress: 1,
                        status: 'complete',
                    },
                }),
            );

            vi.advanceTimersByTime(1000);

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-retry',
                        progress: 0.1,
                        status: 'downloading',
                        message: 'Retrying download',
                    },
                }),
            );

            vi.advanceTimersByTime(1100);

            const list = document.getElementById('downloads-dynamic-list');
            const card = list?.querySelector<HTMLElement>(
                '.download-item-card[data-module-id="mod-retry"]',
            );

            expect(card).not.toBeNull();
            expect(card?.querySelector('.downloads-status-pill')?.textContent).toBe('Downloading');
        });

        it('should render error status card', () => {
            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-err',
                        progress: 0.3,
                        status: 'error',
                        error: 'Disk full',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            const pill = list?.querySelector('.downloads-status-pill');
            expect(pill?.classList.contains('error')).toBe(true);
        });

        it('should remove stale cards (L550)', () => {
            ui.init();

            // Start TWO concurrent downloads
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-a', progress: 0.3, status: 'downloading' },
                }),
            );
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-b', progress: 0.5, status: 'downloading' },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            expect(list?.querySelectorAll('.download-item-card').length).toBe(2);

            // Complete mod-a → cleanup timer removes it from _activeDownloads after 2s
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-a', progress: 1, status: 'complete' },
                }),
            );
            vi.advanceTimersByTime(2100);
            // mod-a removed from _activeDownloads. mod-b still active.

            // Now fire another progress update for mod-b — this calls _renderDynamicList
            // while mod-a's card is still in the DOM but not in _activeDownloads (L550 fires)
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-b', progress: 0.9, status: 'downloading' },
                }),
            );

            // mod-a card should be gone, mod-b card remains
            expect(list?.querySelectorAll('.download-item-card').length).toBe(1);
            expect(
                list?.querySelector('.download-item-card[data-module-id="mod-b"]'),
            ).not.toBeNull();
        });

        it('should patch indeterminate bar on existing card (L599-600)', () => {
            ui.init();

            // Create card with determinate progress
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-patch',
                        progress: 0.5,
                        status: 'downloading',
                    },
                }),
            );

            // Patch to indeterminate
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-patch',
                        progress: -1,
                        status: 'connecting',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            const card = list?.querySelector('.download-item-card');
            const bar = card?.querySelector('.downloads-bar-inner');
            expect(bar?.classList.contains('indeterminate-bar')).toBe(true);
        });

        it('should patch active status pill on existing card', () => {
            ui.init();

            // Create card
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-active',
                        progress: 0.2,
                        status: 'downloading',
                    },
                }),
            );

            // Patch with extracting status (non-complete, non-error → active class)
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-active',
                        progress: 0.9,
                        status: 'extracting',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            const pill = list?.querySelector('.downloads-status-pill');
            expect(pill?.classList.contains('active')).toBe(true);
        });

        it('should refresh existing card translations after language change', () => {
            const tMock = i18nService.t as ReturnType<typeof vi.fn>;
            tMock.mockImplementation((_key: string, def?: string) => def ?? _key);

            ui.init();
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-i18n',
                        progress: 0.2,
                        status: 'downloading',
                        speed: 1024,
                    },
                }),
            );

            tMock.mockImplementation((key: string, def?: string) => {
                const map: Record<string, string> = {
                    'ui.launcher.web.progress': 'Прогресс',
                    'ui.launcher.web.downloaded': 'Скачано',
                    'ui.launcher.web.total': 'Всего',
                    'ui.launcher.web.speed': 'Скорость',
                    'ui.launcher.button.cancel': 'Отмена',
                    'ui.downloads.status.in_progress': 'Загрузка',
                };
                return map[key] ?? def ?? key;
            });

            globalThis.dispatchEvent(new Event('language-changed'));

            const list = document.getElementById('downloads-dynamic-list');
            const card = list?.querySelector<HTMLElement>(
                '.download-item-card[data-module-id="mod-i18n"]',
            );

            expect(card?.querySelector('.downloads-progress-label')?.textContent).toBe('Прогресс');
            expect(card?.querySelector('.downloads-downloaded-label')?.textContent).toBe('Скачано');
            expect(card?.querySelector('.downloads-total-label')?.textContent).toBe('Всего');
            expect(card?.querySelector('.downloads-speed-label')?.textContent).toBe('Скорость');
            expect(card?.querySelector('.downloads-status-pill')?.textContent).toBe('Загрузка');
            expect(card?.querySelector('.download-cancel-btn')?.getAttribute('title')).toBe(
                'Отмена',
            );
        });

        it('should prefer active download entry over stale terminal entry on language change', () => {
            const tMock = i18nService.t as ReturnType<typeof vi.fn>;
            tMock.mockImplementation((key: string, def?: string) => {
                const map: Record<string, string> = {
                    'ui.downloads.status.in_progress': 'Загрузка',
                    'ui.downloads.status.completed': 'Готово',
                };
                return map[key] ?? def ?? key;
            });

            ui.init();
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-old',
                        progress: 1,
                        status: 'complete',
                    },
                }),
            );
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-new',
                        progress: 0.5,
                        status: 'downloading',
                        message: 'Downloading...',
                    },
                }),
            );

            globalThis.dispatchEvent(new Event('language-changed'));

            expect(document.getElementById('downloads-status')?.textContent).toBe('Загрузка');
        });

        it('should patch error status pill on existing card (L613)', () => {
            ui.init();

            // First create a downloading card
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-err-patch',
                        progress: 0.5,
                        status: 'downloading',
                    },
                }),
            );

            // Patch the same card to error status — triggers _patchStatusPill with 'error' (L613)
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-err-patch',
                        progress: 0.5,
                        status: 'error',
                        error: 'Connection refused',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            const pill = list?.querySelector('.downloads-status-pill');
            expect(pill?.classList.contains('error')).toBe(true);
        });

        it('should render waiting label for unknown status (L720)', () => {
            ui.init();

            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-unknown',
                        progress: 0,
                        status: 'some_unknown_status',
                    },
                }),
            );

            const list = document.getElementById('downloads-dynamic-list');
            const pill = list?.querySelector('.downloads-status-pill');
            expect(pill?.textContent).toBe('Waiting');
        });
    });

    // ---------------------------------------------------------- additional null-guard branch coverage
    describe('null-guard branch coverage', () => {
        it('should handle missing downloadsContainer in _updateDownloadsLayout (L164)', () => {
            document.getElementById('downloads-container')?.remove();
            ui.renderDownloadsProgress({ hasActive: true, label: 'Test' });
            // no throw — downloadsContainer branch skipped
        });

        it('should handle missing bar element when percent < 0 (L192)', () => {
            document.getElementById('downloads-progress-bar')?.remove();
            ui.renderDownloadsProgress({ percent: -1, hasActive: true, label: 'Connecting' });
        });

        it('should handle missing text element when percent < 0 (L196)', () => {
            document.getElementById('downloads-progress-text')?.remove();
            ui.renderDownloadsProgress({ percent: -1, hasActive: true, label: 'Connecting' });
        });

        it('should handle missing bar element for normal percent path (L198)', () => {
            document.getElementById('downloads-progress-bar')?.remove();
            ui.renderDownloadsProgress({ percent: 50, hasActive: true, label: 'X' });
        });

        it('should handle missing text element for normal percent path (L202)', () => {
            document.getElementById('downloads-progress-text')?.remove();
            ui.renderDownloadsProgress({ percent: 50, hasActive: true, label: 'X' });
        });

        it('should handle missing statusEl in _updateStatus (L263)', () => {
            document.getElementById('downloads-status')?.remove();
            ui.renderDownloadsProgress({ hasActive: true, label: 'Running' });
        });

        it('should handle missing speedEl in _updateMetaStats (L219)', () => {
            document.getElementById('downloads-speed')?.remove();
            ui.renderDownloadsProgress({ hasActive: true, label: 'X', speed: 1024 });
        });

        it('should handle missing downloadedEl in _updateMetaStats (L220)', () => {
            document.getElementById('downloads-downloaded')?.remove();
            ui.renderDownloadsProgress({ hasActive: true, label: 'X', downloaded: 500 });
        });

        it('should handle missing totalEl in _updateMetaStats (L221)', () => {
            document.getElementById('downloads-total')?.remove();
            ui.renderDownloadsProgress({ hasActive: true, label: 'X', total: 1000 });
        });

        it('should not duplicate dynamic list when already exists (L512 early return)', () => {
            ui.init(); // creates the dynamic list
            ui.init(); // _ensureDynamicList → list already exists → return
            const lists = document.querySelectorAll('#downloads-dynamic-list');
            expect(lists.length).toBe(1);
        });

        it('should handle missing mainCard when activeDownloads.size === 0 (L537)', () => {
            ui.init();
            // Create an active download
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-mc0', progress: 0.5, status: 'downloading' },
                }),
            );
            // Remove mainCard then complete → _renderDynamicList with size 0
            document.getElementById('downloads-main-card')?.remove();
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-mc0', progress: 1, status: 'complete' },
                }),
            );
            vi.advanceTimersByTime(2100);
        });

        it('should handle missing emptyText when activeDownloads.size > 0 (L548)', () => {
            document.getElementById('downloads-empty-text')?.remove();
            ui.init();
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-et2', progress: 0.5, status: 'downloading' },
                }),
            );
            // emptyText null → the classList.add('hidden') call is skipped
        });

        it('should handle missing mainCard when activeDownloads.size > 0 (L543)', () => {
            document.getElementById('downloads-main-card')?.remove();
            ui.init();
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-mc2', progress: 0.5, status: 'downloading' },
                }),
            );
        });

        it('should patch stat[1] with total > 0 (L586 true branch)', () => {
            ui.init();
            // Create card
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-stat',
                        progress: 0.4,
                        status: 'downloading',
                        downloaded: 40,
                        total: 100,
                    },
                }),
            );
            // Patch same card with total still > 0 — hits the _formatBytes branch
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: {
                        module_id: 'mod-stat',
                        progress: 0.8,
                        status: 'downloading',
                        downloaded: 80,
                        total: 100,
                    },
                }),
            );
            const list = document.getElementById('downloads-dynamic-list');
            const statValues = list?.querySelectorAll('.downloads-stat-value');
            // statValues[1] should show formatted bytes, not '--'
            expect(statValues?.[1]?.textContent).not.toBe('--');
        });

        it('should handle label with non-empty string when not active (L233 branch)', () => {
            ui.renderDownloadsProgress({ hasActive: false, label: 'Finished' });
            const label = document.getElementById('downloads-item-label');
            expect(label?.textContent).toBe('Finished');
        });

        it('should compute hasActive from percent/total/label when hasActive is not provided (L134)', () => {
            // Do NOT set hasActive — let the computed path derive it:
            // percent > 0, total > 0, label non-empty, not completed, no error
            ui.renderDownloadsProgress({
                percent: 25,
                downloaded: 100,
                total: 400,
                label: 'Downloading test',
                completed: false,
            });
            const mainCard = document.getElementById('downloads-main-card');
            expect(mainCard?.classList.contains('hidden')).toBe(false);
        });

        it('should handle missing downloadsHeader in _updateDownloadsLayout (L161)', () => {
            document.querySelector('.downloads-header')?.remove();
            ui.renderDownloadsProgress({ hasActive: true, label: 'Test' });
            // no throw — the els.downloadsHeader null branch is taken
        });

        it('should handle missing labelEl in _updateLabel (L228)', () => {
            document.getElementById('downloads-item-label')?.remove();
            ui.renderDownloadsProgress({ hasActive: true, label: 'Test' });
            // _updateLabel returns early at if (!el) return
        });

        it('should handle card with missing moduleId dataset (L552)', () => {
            ui.init();
            // Create a download to trigger _renderDynamicList
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-dataset', progress: 0.5, status: 'downloading' },
                }),
            );
            // Manually inject a card without moduleId into the dynamic list
            const list = document.getElementById('downloads-dynamic-list');
            const orphan = document.createElement('div');
            orphan.className = 'download-item-card';
            // no dataset['moduleId'] set — so || '' returns ''
            list?.appendChild(orphan);

            // Trigger another update to force _renderDynamicList to iterate existing cards
            globalThis.dispatchEvent(
                new CustomEvent('download-progress-update', {
                    detail: { module_id: 'mod-dataset', progress: 0.8, status: 'downloading' },
                }),
            );
            // The orphan card with no moduleId should be removed
            expect(list?.querySelector('.download-item-card:not([data-module-id])')).toBeNull();
        });
    });
});
