/**
 * @module core/services/ErrorHandler
 * @description Global error boundary and management service for catching and logging application errors
 */

import { eventBus } from './EventBus';
import { tracer } from '@/infrastructure/logging/LoggerService';
import { getGlobalWin } from '@/shared/utils/globalAccessor';

/**
 * Detailed error information.
 */
export interface IErrorInfo {
    message: string;
    stack?: string;
    context?: string;
    timestamp: number;
    url?: string;
    line?: number;
    column?: number;
}

type ErrorCallback = (_error: IErrorInfo) => void;

export class ErrorHandler {
    private _initialized = false;
    private _errorLog: IErrorInfo[] = [];
    private readonly _maxLogSize = 100;
    private readonly _callbacks = new Set<ErrorCallback>();

    /**
     * Initializes global error handlers.
     * Should be called once at app startup.
     */
    public init(): void {
        if (this._initialized) {
            tracer.warn('[ErrorHandler] Already initialized');
            return;
        }

        const win = getGlobalWin();
        if (win.errorHandler !== undefined) {
            tracer.warn('[ErrorHandler] Another instance already initialized. Using existing.');
            return;
        }
        win.errorHandler = this;

        globalThis.onerror = (message, source, lineno, colno, error) => {
            const extra: { url?: string; line?: number; column?: number } = {};
            if (source !== undefined && source !== '') extra.url = source;
            if (lineno !== undefined) extra.line = lineno;
            if (colno !== undefined) extra.column = colno;

            this.captureError(
                error ?? new Error(typeof message === 'object' ? JSON.stringify(message) : message),
                'window.onerror',
                extra,
            );
            return false;
        };

        globalThis.onunhandledrejection = (event) => {
            const error =
                event.reason instanceof Error ? event.reason : new Error(String(event.reason));
            this.captureError(error, 'unhandledrejection');
        };

        this._initialized = true;
        tracer.info('[ErrorHandler] Initialized');
    }

    /**
     * Captures and processes an error, logging it and notifying subscribers.
     */
    public captureError(
        error: Error,
        context?: string,
        extra?: { url?: string; line?: number; column?: number },
    ): void {
        const errorInfo = this._createErrorInfo(error, context, extra);
        this._pushError(errorInfo);

        tracer.error(`[ErrorHandler] ${context ?? 'Error'} - ${error.message}`, error);

        const eventPayload: { error: Error; context?: string } = { error };
        if (context !== undefined && context !== '') {
            eventPayload.context = context;
        }
        eventBus.emit('error:global', eventPayload);

        this._callbacks.forEach((cb) => {
            try {
                cb(errorInfo);
            } catch (callbackError) {
                tracer.error('[ErrorHandler] Callback error:', callbackError);
            }
        });

        this._showErrorToast(error.message);
    }

    /**
     * Registers a callback for errors.
     * @returns Unsubscribe function
     */
    public onError(callback: ErrorCallback): () => void {
        this._callbacks.add(callback);
        return () => this._callbacks.delete(callback);
    }

    /**
     * Retrieves the recent error log.
     */
    public getErrorLog(): IErrorInfo[] {
        return [...this._errorLog];
    }

    /**
     * Clears the internal error log.
     */
    public clearErrorLog(): void {
        this._errorLog = [];
    }

    /**
     * Wraps an async function with global error handling.
     */
    public async wrapAsync<T>(fn: () => Promise<T>, context?: string): Promise<T | undefined> {
        try {
            return await fn();
        } catch (error) {
            this.captureError(error instanceof Error ? error : new Error(String(error)), context);
            return undefined;
        }
    }

    /**
     * Creates a safe wrapper for event handlers with error boundaries.
     */
    public safeHandler<T extends Event>(
        handler: (_event: T) => void,
        context?: string,
    ): (_event: T) => void {
        return (_event: T) => {
            try {
                handler(_event);
            } catch (error) {
                this.captureError(
                    error instanceof Error ? error : new Error(String(error)),
                    context ?? 'eventHandler',
                );
            }
        };
    }

    private _createErrorInfo(
        error: Error,
        context?: string,
        extra?: { url?: string; line?: number; column?: number },
    ): IErrorInfo {
        const errorInfo: IErrorInfo = {
            message: error.message,
            timestamp: Date.now(),
        };

        if (error.stack !== undefined && error.stack !== '') errorInfo.stack = error.stack;
        if (context !== undefined && context !== '') errorInfo.context = context;
        if (extra?.url !== undefined && extra.url !== '') errorInfo.url = extra.url;
        if (extra?.line !== undefined) errorInfo.line = extra.line;
        if (extra?.column !== undefined) errorInfo.column = extra.column;

        return errorInfo;
    }

    private _pushError(errorInfo: IErrorInfo): void {
        this._errorLog.push(errorInfo);
        if (this._errorLog.length > this._maxLogSize) {
            this._errorLog.shift();
        }
    }

    /**
     * Shows a user-friendly error toast via the UI.
     */
    private _showErrorToast(message: string): void {
        const toastContainer = document.getElementById('toast-container');
        if (!(toastContainer instanceof HTMLElement)) {
            return;
        }

        const toast = document.createElement('div');
        toast.className = 'toast toast-error';
        toast.appendChild(this._createToastIcon());
        toast.appendChild(this._createToastContent(message));
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-fade-out');
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 5000);
    }

    private _createToastIcon(): HTMLDivElement {
        const iconContainer = document.createElement('div');
        iconContainer.className = 'toast-icon';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');

        svg.appendChild(this._createSvgNode('circle', { cx: '12', cy: '12', r: '10' }));
        svg.appendChild(this._createSvgNode('line', { x1: '15', y1: '9', x2: '9', y2: '15' }));
        svg.appendChild(this._createSvgNode('line', { x1: '9', y1: '9', x2: '15', y2: '15' }));

        iconContainer.appendChild(svg);
        return iconContainer;
    }

    private _createToastContent(message: string): HTMLDivElement {
        const content = document.createElement('div');
        content.className = 'toast-content';
        content.appendChild(this._createTextNode('toast-title', 'Error'));
        content.appendChild(this._createTextNode('toast-message', message));
        return content;
    }

    private _createTextNode(className: string, text: string): HTMLDivElement {
        const element = document.createElement('div');
        element.className = className;
        element.textContent = text;
        return element;
    }

    private _createSvgNode(
        tagName: 'circle' | 'line',
        attributes: Record<string, string>,
    ): SVGElement {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tagName);
        Object.entries(attributes).forEach(([key, value]) => {
            node.setAttribute(key, value);
        });
        return node;
    }
}

// Singleton export
export const errorHandler = new ErrorHandler();
