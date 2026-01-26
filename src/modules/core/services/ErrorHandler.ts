/**
 * @module core/services/ErrorHandler
 * @description Global error boundary and management service for catching and logging application errors
 */

import { eventBus } from './EventBus';

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
interface IErrorHandlerGlobal {
    errorHandler?: ErrorHandler;
}

class ErrorHandler {
    private _initialized = false;
    private _errorLog: IErrorInfo[] = [];
    private readonly _maxLogSize = 100;
    private readonly _callbacks: Set<ErrorCallback> = new Set();

    /**
     * Initializes global error handlers.
     * Should be called once at app startup.
     */
    public init(): void {
        if (this._initialized) {
            console.warn('[ErrorHandler] Already initialized');
            return;
        }

        const win = globalThis as unknown as IErrorHandlerGlobal;
        if (win.errorHandler) {
            console.warn('[ErrorHandler] Another instance already initialized. Using existing.');
            return;
        }
        win.errorHandler = this;

        // Catch uncaught errors
        globalThis.onerror = (message, source, lineno, colno, error) => {
            this.captureError(
                error ||
                    new Error(
                        typeof message === 'object' ? JSON.stringify(message) : String(message),
                    ),
                'window.onerror',
                { url: source, line: lineno, column: colno },
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
            stack: error.stack,
            context,
            timestamp: Date.now(),
            url: extra?.url,
            line: extra?.line,
            column: extra?.column,
        };

        // Add to log (with size limit)
        this._errorLog.push(errorInfo);
        if (this._errorLog.length > this._maxLogSize) {
            this._errorLog.shift();
        }

        // Console log with styling
        console.error(
            `%c[ErrorHandler] ${context || 'Error'}`,
            'color: #ff4444; font-weight: bold',
            error,
        );

        // Emit event for other components
        eventBus.emit('error:global', { error, context });

        // Notify callbacks
        this._callbacks.forEach((cb) => {
            try {
                cb(errorInfo);
            } catch (e) {
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
        toast.innerHTML = `
            <div class="toast-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
            </div>
            <div class="toast-content">
                <div class="toast-title">Error</div>
                <div class="toast-message">${this._escapeHtml(message)}</div>
            </div>
        `;

        toastContainer.appendChild(toast);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            toast.classList.add('toast-fade-out');
            setTimeout(() => toast.remove(), 300);
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
                    context || 'eventHandler',
                );
            }
        };
    }

    /**
     * Safely escapes HTML content for display.
     */
    private _escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Singleton export
export const errorHandler = new ErrorHandler();
