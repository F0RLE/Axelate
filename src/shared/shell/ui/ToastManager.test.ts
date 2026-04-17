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

    it('should close hidden dialogs before showing a toast', () => {
        const hiddenDialog = document.createElement('dialog');
        hiddenDialog.className = 'hidden';
        hiddenDialog.setAttribute('open', '');
        hiddenDialog.close = vi.fn(() => {
            hiddenDialog.removeAttribute('open');
        });
        document.body.appendChild(hiddenDialog);

        manager.show('hello', 'info');

        expect(hiddenDialog.close).toHaveBeenCalledTimes(1);
        expect(hiddenDialog.hasAttribute('open')).toBe(false);
        expect(document.querySelector('.toast')).not.toBeNull();
    });

    it('should render title and reuse a single toast container', () => {
        manager.show('first', 'info', 1000, 'Title');
        manager.show('second', 'success', 1000, 'Again');

        const containers = document.querySelectorAll('#toast-container');
        const toasts = document.querySelectorAll('#toast-container .toast');

        expect(containers).toHaveLength(1);
        expect(toasts).toHaveLength(2);
        expect(document.querySelector('#toast-container .toast-title')?.textContent).toBe('Title');
    });

    it('should attach the toast container to the active dialog top layer host', () => {
        const modal = document.createElement('dialog');
        modal.setAttribute('open', '');
        document.body.appendChild(modal);

        manager.show('inside modal', 'info');

        const container = document.getElementById('toast-container');
        expect(container?.parentElement).toBe(modal);
        expect(container?.classList.contains('toast-container--modal')).toBe(true);
    });

    it('should create an empty toast container without leaked text nodes', () => {
        manager.show('inside modal', 'info');

        const container = document.getElementById('toast-container');
        expect(container?.childNodes).toHaveLength(1);
        expect(container?.textContent).toContain('inside modal');
    });

    it('should move the toast container back to body when no modal is open', () => {
        const modal = document.createElement('dialog');
        modal.setAttribute('open', '');
        document.body.appendChild(modal);

        manager.show('inside modal', 'info');
        modal.removeAttribute('open');

        manager.show('outside modal', 'info');

        const container = document.getElementById('toast-container');
        expect(container?.parentElement).toBe(document.body);
        expect(container?.classList.contains('toast-container--modal')).toBe(false);
    });

    it('should remove the toast container after the last toast disappears', () => {
        manager.show('bye', 'info', 100);

        vi.advanceTimersByTime(400);

        expect(document.getElementById('toast-container')).toBeNull();
    });
});
