/**
 * @module core/services/ErrorHandler
 * @description Global error boundary and management service for catching and logging application errors
 */

import DOMPurify from 'dompurify';
import { eventBus } from './EventBus';
import type { TGlobalWin } from '../types/global_bridge_types';

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

// Local type definition for global extending
// IErrorHandlerGlobal removed

class ErrorHandler {
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
            // eslint-disable-next-line no-console
            console.warn('[ErrorHandler] Already initialized');
            return;
        }

        const win = globalThis as TGlobalWin;
        if (win.errorHandler !== undefined) {
            // eslint-disable-next-line no-console
            console.warn('[ErrorHandler] Another instance already initialized. Using existing.');
            return;
        }
        win.errorHandler = this;

        // Catch uncaught errors
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
            return false; // Don't prevent default handling
        };

        // Catch unhandled promise rejections
        globalThis.onunhandledrejection = (event) => {
            const error =
                event.reason instanceof Error ? event.reason : new Error(String(event.reason));
            this.captureError(error, 'unhandledrejection');
        };

        this._initialized = true;
        // eslint-disable-next-line no-console
        console.log('[ErrorHandler] Initialized');
    }

    /**
     * Captures and processes an error, logging it and notifying subscribers.
     */
    public captureError(
        error: Error,
        context?: string,
        extra?: { url?: string; line?: number; column?: number },
    ): void {
        const errorInfo: IErrorInfo = {
            message: error.message,
            timestamp: Date.now(),
        };

        if (error.stack !== undefined && error.stack !== '') errorInfo.stack = error.stack;
        if (context !== undefined && context !== '') errorInfo.context = context;
        if (extra?.url !== undefined && extra.url !== '') errorInfo.url = extra.url;
        if (extra?.line !== undefined) errorInfo.line = extra.line;
        if (extra?.column !== undefined) errorInfo.column = extra.column;

        // Add to log (with size limit)
        this._errorLog.push(errorInfo);
        if (this._errorLog.length > this._maxLogSize) {
            this._errorLog.shift();
        }

        // Console log with styling
        // eslint-disable-next-line no-console
        console.error(
            `%c[ErrorHandler] ${context ?? 'Error'}`,
            'color: #ff4444; font-weight: bold',
            error,
        );

        // Emit event for other components
        const eventPayload: { error: Error; context?: string } = { error };
        if (context !== undefined && context !== '') eventPayload.context = context;
        eventBus.emit('error:global', eventPayload);

        // Notify callbacks
        this._callbacks.forEach((cb) => {
            try {
                cb(errorInfo);
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('[ErrorHandler] Callback error:', e);
            }
        });

        // Show toast notification (if available)
        this._showErrorToast(error.message);
    }

    /**
     * Shows a user-friendly error toast via the UI.
     */
    private _showErrorToast(message: string): void {
        // Try to use existing toast system
        const toastContainer = document.getElementById('toast-container');
        if (!toastContainer) return;

        const toast = document.createElement('div');
        toast.className = 'toast toast-error';
        toast.innerHTML = DOMPurify.sanitize(`
            <div class="toast-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
            </div>
            <div class="toast-content">
                <div class="toast-title">Error</div>
                <div class="toast-message">${message}</div>
            </div>
        `);

        toastContainer.appendChild(toast);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            toast.classList.add('toast-fade-out');
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 5000);
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

}

// Singleton export
export const errorHandler = new ErrorHandler();
