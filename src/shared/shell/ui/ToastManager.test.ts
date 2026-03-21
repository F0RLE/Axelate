import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastManager } from './ToastManager';

describe('ToastManager', () => {
    let manager: ToastManager;

    beforeEach(() => {
        document.body.innerHTML = '';
        (
            globalThis as unknown as {
                t: (key: string, fallback: string) => string;
            }
        ).t = (_key, fallback) => fallback;
        manager = new ToastManager();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should cancel pending removal when updating an existing toast by id', () => {
        manager.show('first', 'info', 100, null, 'same');
        vi.advanceTimersByTime(100);

        const toast = document.getElementById('toast-same');
        if (!(toast instanceof HTMLElement)) {
            throw new Error('Toast was not created');
        }

        expect(toast.classList.contains('leaving')).toBe(true);

        manager.show('second', 'info', 200, null, 'same');
        expect(toast.classList.contains('leaving')).toBe(false);

        vi.advanceTimersByTime(299);
        expect(document.getElementById('toast-same')).toBe(toast);

        vi.advanceTimersByTime(201);
        expect(document.getElementById('toast-same')).toBeNull();
    });

    it('should update existing toast type when reusing the same id', () => {
        manager.show('first', 'info', 1000, null, 'same');
        manager.show('second', 'error', 1000, null, 'same');

        const toast = document.getElementById('toast-same');
        if (!(toast instanceof HTMLElement)) {
            throw new Error('Toast was not created');
        }

        expect(toast.classList.contains('error')).toBe(true);
        expect(toast.classList.contains('info')).toBe(false);
        expect(toast.textContent).toContain('second');
    });
});
