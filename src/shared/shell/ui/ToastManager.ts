import DOMPurify from 'dompurify';

type ToastType = 'success' | 'error' | 'warning' | 'info' | (string & {});

/**
 * @interface ToastElement
 * @description Extended HTMLElement for toast notifications with timeout tracking.
 */
export interface ToastElement extends HTMLElement {
    _timeout?: ReturnType<typeof setTimeout>;
    _removeTimeout?: ReturnType<typeof setTimeout>;
    _actionHandler?: () => void;
}

/**
 * @class ToastManager
 * @description Handles the lifecycle, queueing, and rendering of toast notifications.
 */
export class ToastManager {
    private static readonly _containerId = 'toast-container';
    private static readonly _leavingDurationMs = 300;

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
        type: ToastType = 'info',
        duration = 3000,
        title: string | null = null,
        id: string | null = null,
        onClick: (() => void) | null = null,
    ): void {
        const normalizedMessage = message.trim();
        const normalizedTitle = title?.trim() ?? null;
        if (normalizedMessage === '' && (normalizedTitle === null || normalizedTitle === '')) {
            return;
        }

        this._normalizeHiddenDialogs();
        const container = this._ensureToastContainer();
        const existingToast = id === null ? null : this._findToastById(id);

        if (existingToast !== null) {
            this._updateExistingToast(
                existingToast,
                normalizedMessage,
                type,
                normalizedTitle,
                duration,
                onClick,
            );
            return;
        }

        this._createToast(
            container,
            normalizedMessage,
            type,
            duration,
            normalizedTitle,
            id,
            onClick,
        );
    }

    private _normalizeHiddenDialogs(): void {
        document.querySelectorAll<HTMLDialogElement>('dialog.hidden').forEach((dialog) => {
            if (!dialog.open) {
                dialog.removeAttribute('open');
                return;
            }

            try {
                dialog.close();
            } catch {
                dialog.removeAttribute('open');
            }
        });
    }

    private _ensureToastContainer(): HTMLElement {
        const host = this._resolveToastHost();
        let container = document.getElementById(ToastManager._containerId);
        if (container === null) {
            container = document.createElement('div');
            container.className = 'toast-container';
            container.id = ToastManager._containerId;
            host.appendChild(container);
        } else if (container.parentElement !== host) {
            host.appendChild(container);
        }

        container.classList.toggle('toast-container--modal', host instanceof HTMLDialogElement);
        return container;
    }

    private _resolveToastHost(): HTMLElement {
        const dialogs = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));
        for (let index = dialogs.length - 1; index >= 0; index -= 1) {
            const dialog = dialogs[index];
            if (dialog === undefined) {
                continue;
            }
            if (!dialog.classList.contains('hidden')) {
                return dialog;
            }
        }

        return document.body;
    }

    private _findToastById(id: string): ToastElement | null {
        const toast = document.getElementById(`toast-${id}`);
        return toast instanceof HTMLElement ? (toast as ToastElement) : null;
    }

    private _updateExistingToast(
        toast: ToastElement,
        message: string,
        type: ToastType,
        title: string | null,
        duration: number,
        onClick: (() => void) | null,
    ): void {
        const contentElement = toast.querySelector('.toast-content');
        if (contentElement instanceof HTMLElement) {
            contentElement.innerHTML = this._renderToastContent(message, title);
        }

        toast.className = `toast ${type}`;
        toast.classList.remove('leaving');
        this._setToastAction(toast, onClick);
        this._clearToastTimers(toast);
        this._scheduleToastRemoval(toast, duration);
    }

    private _createToast(
        container: HTMLElement,
        message: string,
        type: ToastType,
        duration: number,
        title: string | null,
        id: string | null,
        onClick: (() => void) | null,
    ): void {
        const toast = document.createElement('div') as ToastElement;
        toast.className = `toast ${type}`;

        if (id !== null) {
            toast.id = `toast-${id}`;
        }

        toast.innerHTML = this._sanitizeHtml(`
            <div class="toast-content">
                ${this._buildToastTitleMarkup(title)}
                <div class="toast-message">${message}</div>
            </div>
        `);

        this._setToastAction(toast, onClick);
        container.appendChild(toast);
        this._scheduleToastRemoval(toast, duration);
    }

    private _renderToastContent(message: string, title: string | null): string {
        return this._sanitizeHtml(`
            ${this._buildToastTitleMarkup(title)}
            <div class="toast-message">${message}</div>
        `);
    }

    private _buildToastTitleMarkup(title: string | null): string {
        if (title === null || title === '') {
            return '';
        }

        return `<div class="toast-title">${title}</div>`;
    }

    private _sanitizeHtml(html: string): string {
        return DOMPurify.sanitize(html, this._purifyConfig);
    }

    private _scheduleToastRemoval(toast: ToastElement, duration: number): void {
        toast._timeout = setTimeout(() => {
            delete toast._timeout;
            toast.classList.add('leaving');
            toast._removeTimeout = setTimeout(() => {
                delete toast._removeTimeout;
                toast.remove();
                this._cleanupContainer();
            }, ToastManager._leavingDurationMs);
        }, duration);
    }

    private _clearToastTimers(toast: ToastElement): void {
        if (toast._timeout !== undefined) {
            clearTimeout(toast._timeout);
            delete toast._timeout;
        }

        if (toast._removeTimeout !== undefined) {
            clearTimeout(toast._removeTimeout);
            delete toast._removeTimeout;
        }
    }

    private _setToastAction(toast: ToastElement, onClick: (() => void) | null): void {
        if (toast._actionHandler !== undefined) {
            toast.removeEventListener('click', toast._actionHandler);
            toast.removeEventListener('keydown', this._handleActionKeydown);
            delete toast._actionHandler;
        }

        if (onClick === null) {
            toast.classList.remove('toast--actionable');
            toast.removeAttribute('role');
            toast.removeAttribute('tabindex');
            return;
        }

        toast._actionHandler = onClick;
        toast.classList.add('toast--actionable');
        toast.setAttribute('role', 'button');
        toast.setAttribute('tabindex', '0');
        toast.addEventListener('click', onClick);
        toast.addEventListener('keydown', this._handleActionKeydown);
    }

    private readonly _handleActionKeydown = (event: KeyboardEvent): void => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        const toast = event.currentTarget;
        if (toast instanceof HTMLElement) {
            toast.click();
        }
    };

    private _cleanupContainer(): void {
        const container = document.getElementById(ToastManager._containerId);
        if (container === null) {
            return;
        }

        if (container.childElementCount === 0) {
            container.remove();
        }
    }
}
