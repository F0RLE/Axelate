import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugUI } from './DebugUI';
import type { DebugService } from '../services/DebugService';

describe('DebugUI lifecycle', () => {
    let ui: DebugUI | null = null;

    beforeEach(() => {
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
            <button class="console-tab"></button>
            <button id="clear-logs-btn"></button>
            <button id="copy-logs-btn"></button>
            <div id="page-debug" class="active"></div>
            <div id="logs-general" class="logs-pane active"></div>
        `;
        (globalThis as unknown as { t?: (key: string, fallback: string) => string }).t = (
            key,
            fallback,
        ) => `${key}:${fallback}`;
        (globalThis as unknown as { showToast?: ReturnType<typeof vi.fn> }).showToast = vi.fn();
        vi.clearAllMocks();
    });

    afterEach(() => {
        ui?.destroy();
        ui = null;
        document.body.innerHTML = '';
    });

    function createDebugUI(): DebugUI {
        const service = {
            clearLogs: vi.fn().mockResolvedValue(true),
            getLogs: vi.fn().mockReturnValue([]),
            fetchLogs: vi.fn().mockResolvedValue([]),
        } as unknown as DebugService;

        return new DebugUI(service);
    }

    it('should restore previous global debug shims on destroy', () => {
        const previousSetDebugTab = vi.fn();
        const previousSetLogView = vi.fn();
        const previousClearLogs = vi.fn().mockResolvedValue(undefined);

        globalThis.setDebugTab = previousSetDebugTab;
        globalThis.setLogView = previousSetLogView;
        globalThis.clearLogs = previousClearLogs;

        ui = createDebugUI();
        ui.init();

        expect(globalThis.setDebugTab).not.toBe(previousSetDebugTab);
        expect(globalThis.setLogView).not.toBe(previousSetLogView);
        expect(globalThis.clearLogs).not.toBe(previousClearLogs);

        ui.destroy();

        expect(globalThis.setDebugTab).toBe(previousSetDebugTab);
        expect(globalThis.setLogView).toBe(previousSetLogView);
        expect(globalThis.clearLogs).toBe(previousClearLogs);
    });

    it('should remove slider listeners on destroy', () => {
        ui = createDebugUI();
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
        ui = createDebugUI();
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

        if (typeof globalThis.setLogView === 'function') {
            globalThis.setLogView('general', document.querySelector('.console-tab') as HTMLElement);
        }
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
        const service = {
            clearLogs: vi.fn().mockResolvedValue(true),
            getLogs: vi.fn().mockReturnValue([
                { level: 'INFO', message: ' hello ', source: 'system', timestamp: 1 },
                { level: 'ERROR', message: 'boom', source: 'api-gateway', timestamp: 2 },
            ]),
            fetchLogs: vi.fn().mockResolvedValue([{ level: 'INFO', message: 'new' }]),
        } as unknown as DebugService;

        ui = new DebugUI(service);
        const clipboardWrite = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            configurable: true,
            value: { writeText: clipboardWrite },
        });
        delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

        ui.init();
        await ui.clearLogs();
        expect(service.clearLogs).toHaveBeenCalled();

        await ui.copyLogs();
        expect(clipboardWrite).toHaveBeenCalledWith('hello\nboom');

        (service.getLogs as ReturnType<typeof vi.fn>).mockReturnValue([]);
        await ui.copyLogs();
        expect(
            (globalThis as unknown as { showToast: ReturnType<typeof vi.fn> }).showToast,
        ).toHaveBeenCalledWith('ui.debug.logs_empty:No logs to copy', 'warning', 1500);
    });
});
