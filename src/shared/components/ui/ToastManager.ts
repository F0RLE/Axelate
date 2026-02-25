import DOMPurify from 'dompurify';
import { getGlobalWin } from '@/shared/utils/globalAccessor';

/**
 * @interface ToastElement
 * @description Extended HTMLElement for toast notifications with timeout tracking.
 */
export interface ToastElement extends HTMLElement {
    _timeout?: ReturnType<typeof setTimeout>;
}

/**
 * @class ToastManager
 * @description Handles the lifecycle, queueing, and rendering of toast notifications.
 */
export class ToastManager {
    private readonly _purifyConfig = {
        ALLOWED_TAGS: [
            'b',
            'i',
            'em',
            'strong',
            'a',
            'p',
            'br',
            'code',
            'pre',
            'div',
            'span',
            'svg',
            'line',
        ],
        ALLOWED_ATTR: [
            'href',
            'class',
            'style',
            'viewBox',
            'width',
            'height',
            'stroke',
            'stroke-width',
            'fill',
            'stroke-linecap',
            'stroke-linejoin',
            'x1',
            'y1',
            'x2',
            'y2',
        ],
        ALLOW_DATA_ATTR: true,
    };
    private toastQueue: ToastElement[] = [];

    /**
     * Shows a toast notification.
     * @param {string} message - The message to display.
     * @param {string} [type='info'] - The toast type (success, error, warning, info).
     * @param {number} [duration=3000] - Duration in milliseconds.
     * @param {string|null} [title=null] - Optional toast title.
     * @param {string|null} [id=null] - Optional unique ID to prevent duplicates.
     */
    public show(
        message: string,
        type = 'info',
        duration = 3000,
        title: string | null = null,
        id: string | null = null,
    ): void {
        const container = this._ensureToastContainer();

        // Check for existing toast with this ID
        if (id !== null) {
            const existingToast = document.getElementById(`toast-${id}`);
            if (existingToast !== null) {
                this._updateExistingToast(existingToast as ToastElement, message, title, duration);
                return;
            }
        }

        this._createToast(container, message, type, duration, title, id);
    }

    private _ensureToastContainer(): HTMLElement {
        let container = document.getElementById('toast-container');
        if (container === null) {
            container = document.createElement('div');
            container.className = 'toast-container';
            container.id = 'toast-container';
            container.style.zIndex = '9999';
            const win = getGlobalWin();
            // Fallback for translation if not available
            const containerTitle =
                typeof win.t === 'function' ? win.t('ui.toast.container', '') : '';
            container.innerHTML = DOMPurify.sanitize(containerTitle, this._purifyConfig);
            document.body.appendChild(container);
        }
        return container;
    }

    private _updateExistingToast(
        toast: ToastElement,
        message: string,
        title: string | null,
        duration: number,
    ): void {
        const contentEl = toast.querySelector('.toast-content');
        if (contentEl) {
            contentEl.innerHTML = DOMPurify.sanitize(
                `
                ${title !== null && title !== '' ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            `,
                this._purifyConfig,
            );
        }

        // Reset timer
        if (toast._timeout !== undefined) clearTimeout(toast._timeout);

        toast.classList.remove('leaving');

        toast._timeout = setTimeout(() => {
            toast.classList.add('leaving');
            setTimeout(() => {
                toast.remove();
                this.toastQueue = this.toastQueue.filter((t) => t !== toast);
            }, 300);
        }, duration);
    }

    private _createToast(
        container: HTMLElement,
        message: string,
        type: string,
        duration: number,
        title: string | null,
        id: string | null,
    ) {
        const toast = document.createElement('div') as ToastElement;
        toast.className = `toast ${type}`;
        if (id !== null) toast.id = `toast-${id}`;

        toast.innerHTML = DOMPurify.sanitize(
            `
            <div class="toast-content">
                ${title !== null && title !== '' ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            </div>
        `,
            this._purifyConfig,
        );

        container.appendChild(toast);
        this.toastQueue.push(toast);

        toast._timeout = setTimeout(() => {
            toast.classList.add('leaving');
            setTimeout(() => {
                toast.remove();
                this.toastQueue = this.toastQueue.filter((t) => t !== toast);
            }, 300);
        }, duration);
    }
}
