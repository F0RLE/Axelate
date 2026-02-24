/* eslint-disable no-console */
/**
 * @module core/services/LoggerService
 * @description Centralized logging service for capturing console output and sending it to the backend.
 * Implements the Singleton pattern as defined in Axelate Standards.
 *
 * @example
 * ```typescript
 * import { logger } from './LoggerService';
 *
 * logger.info('System event occurred');
 * ```
 */

import type { ILogEntry } from '@/shared/types/coreTypes';
import type { TGlobalWin } from '@/shared/types/global_bridge_types';

export class LoggerService {
    private _buffer: ILogEntry[] = [];
    private _flushTimeout: ReturnType<typeof setTimeout> | null = null;
    private readonly _FLUSH_INTERVAL = 500;
    private readonly _MAX_BUFFER = 10;
    private readonly _originalConsoleError: (..._args: unknown[]) => void;
    private readonly _originalConsoleWarn: (..._args: unknown[]) => void;
    private readonly _originalConsoleLog: (..._args: unknown[]) => void;
    private readonly _originalConsoleDebug: (..._args: unknown[]) => void;

    // Flag to prevent recursive logging loops during interception
    private _isInternalLog = false;
    private _initialized = false;
    /** Injected after TauriProvider is ready — avoids direct __TAURI__ access. */
    private _transport: ((logs: { level: string; message: string }[]) => Promise<void>) | null =
        null;

    constructor() {
        // Capture original methods before overriding
        this._originalConsoleError = console.error.bind(console);
        this._originalConsoleWarn = console.warn.bind(console);
        this._originalConsoleLog = console.log.bind(console);
        this._originalConsoleDebug = console.debug.bind(console);
    }

    /**
     * Injects the Tauri transport after TauriProvider is initialized.
     * Decouples LoggerService from direct __TAURI__ access (§4.1).
     */
    public setTransport(fn: (logs: { level: string; message: string }[]) => Promise<void>): void {
        this._transport = fn;
    }

    /**
     * Idempotent initialization of the service.
     * Required by Section 16.2 of Axelate Standards.
     *
     * @sideeffect Modifies globalThis.console and globalThis.onerror
     */
    public init(): void {
        if (this._initialized) {
            console.warn('[LoggerService] Already initialized');
            return;
        }

        this._setupInterceptors();

        this._initialized = true;
    }

    private _setupInterceptors(): void {
        const win = globalThis as TGlobalWin;

        // Intercept window.onerror for uncaught JS errors
        win.onerror = (
            message: string | Event,
            source?: string,
            lineno?: number,
            colno?: number,
            error?: Error,
        ) => {
            if (this._isInternalLog) return true; // Stop propagation to avoid recursion

            const msgStr = this._safeStringify(message);
            const stackTrace = error?.stack;
            const stack =
                typeof stackTrace === 'string' && stackTrace !== '' ? `\nStack: ${stackTrace}` : '';
            const errMsg = `${msgStr} at ${String(source)}:${String(lineno)}:${String(colno)}${stack}`;

            this.log('ERROR', errMsg);
            return false; // Let default handler also run
        };

        // Intercept unhandled promise rejections
        win.onunhandledrejection = (event: PromiseRejectionEvent) => {
            if (this._isInternalLog) return;

            const reason =
                event.reason instanceof Error
                    ? event.reason.message
                    : this._safeStringify(event.reason);
            this.log('ERROR', `Unhandled Promise: ${reason}`);
        };

        // Intercept console methods
        console.error = (...args: unknown[]) => {
            this._originalConsoleError(...args);
            if (this._isInternalLog) return;
            const msg = args.map((a) => this._safeStringify(a)).join(' ');
            this.log('ERROR', msg);
        };

        console.warn = (...args: unknown[]) => {
            this._originalConsoleWarn(...args);
            if (this._isInternalLog) return;
            const msg = args.map((a) => this._safeStringify(a)).join(' ');
            this.log('WARN', msg);
        };

        // We generally don't intercept log/debug to avoid noise,
        // but we could if needed. For now, we only shadow error/warn for telemetry.
    }

    /**
     * Safely stringifies various data types for logging.
     */
    private _safeStringify(obj: unknown): string {
        try {
            if (typeof obj === 'string') return obj;
            if (obj === null) return 'null';
            if (obj === undefined) return 'undefined';
            if (obj instanceof Error) return obj.stack ?? obj.message;
            if (typeof obj === 'function') return `[Function: ${obj.name || 'anonymous'}]`;
            if (typeof obj === 'symbol') return obj.toString();
            if (typeof obj === 'bigint') return `${obj.toString()}n`;

            return this._stringifyComplex(obj);
        } catch {
            return this._fallbackStringify(obj);
        }
    }

    private _stringifyComplex(obj: unknown): string {
        const cache = new Set();
        return JSON.stringify(obj, (key, value) => {
            if (typeof value === 'object' && value !== null) {
                if (cache.has(value)) return '[Circular]';
                cache.add(value);
            }
            return this._redact(key, value);
        });
    }

    /**
     * Redacts sensitive keys from logs.
     */
    private _redact(key: string, value: unknown): unknown {
        const SENSITIVE_KEYS = /password|token|secret|key|auth|authorization|credit_card/i;
        if (key && SENSITIVE_KEYS.test(key)) {
            return '[REDACTED]';
        }
        return value;
    }

    /**
     * Last-resort stringification for deeply nested or broken objects.
     */
    private _fallbackStringify(obj: unknown): string {
        try {
            if (obj === null) return 'null';
            if (obj === undefined) return 'undefined';

            if (typeof obj === 'function') {
                return `[Function: ${obj.name || 'anonymous'}]`;
            }

            if (
                typeof obj === 'string' ||
                typeof obj === 'number' ||
                typeof obj === 'boolean' ||
                typeof obj === 'bigint' ||
                typeof obj === 'symbol'
            ) {
                return String(obj);
            }

            return '[Object]';
        } catch {
            return '[Unstringifiable Object]';
        }
    }

    /**
     * Main entry point for logging messages with levels.
     *
     * @param level - Log severity level
     * @param message - The message body to log
     */
    public log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string): void {
        // Prevent recursion if log() triggers something that logs again
        if (this._isInternalLog) return;
        this._isInternalLog = true;

        try {
            this._logToScreen(level, message);

            this._buffer.push({
                level,
                message,
                timestamp: new Date().toISOString(),
            });

            if (level === 'ERROR' || this._buffer.length >= this._MAX_BUFFER) {
                void this._flush();
            } else {
                if (this._flushTimeout) clearTimeout(this._flushTimeout);
                this._flushTimeout = setTimeout(() => {
                    void this._flush();
                }, this._FLUSH_INTERVAL);
            }
        } finally {
            this._isInternalLog = false;
        }
    }

    public info(message: string, ...args: unknown[]): void {
        this._originalConsoleLog(`[INFO] ${message}`, ...args);
        this.log('INFO', this._formatMessage(message, args));
    }

    public warn(message: string, ...args: unknown[]): void {
        // Original warn is handled by interceptor, so we don't call it here to avoid double logging
        // But if called explicitly:
        this.log('WARN', this._formatMessage(message, args));
    }

    public error(message: string, ...args: unknown[]): void {
        // Original error is handled by interceptor
        this.log('ERROR', this._formatMessage(message, args));
    }

    public debug(message: string, ...args: unknown[]): void {
        this._originalConsoleDebug(`[DEBUG] ${message}`, ...args);
        this.log('DEBUG', this._formatMessage(message, args));
    }

    /**
     * Formats a message template with optional arguments.
     */
    private _formatMessage(message: string, args: unknown[]): string {
        if (args.length === 0) return message;
        return `${message} ${args.map((a) => this._safeStringify(a)).join(' ')}`;
    }

    /**
     * Flushes the current log buffer to the backend.
     */
    private async _flush(): Promise<void> {
        if (this._buffer.length === 0) return;

        // Take snapshot and clear buffer immediately
        const logs = [...this._buffer];
        this._buffer = [];

        try {
            if (this._transport) {
                // Use injected transport (TauriProvider path — preferred)
                await this._transport(logs.map((l) => ({ level: l.level, message: l.message })));
            } else {
                // Fallback: direct __TAURI__ access during early boot before setTransport() is called
                const g = globalThis as unknown as {
                    __TAURI__?: { core: { invoke: (cmd: string, args: unknown) => Promise<void> } };
                };
                if (g.__TAURI__?.core) {
                    await g.__TAURI__.core.invoke('log_batch', {
                        logs: logs.map((l) => ({ level: l.level, message: l.message })),
                    });
                }
            }
        } catch (e) {
            this._originalConsoleError('Log batch sync failed:', e);
        }
    }

    /**
     * Renders log messages to an on-screen debug overlay.
     */
    private _logToScreen(level: string, message: string): void {
        const overlay = document.getElementById('debug-overlay');
        if (overlay !== null) {
            overlay.style.display = 'block';
            const line = document.createElement('div');
            line.textContent = `[${new Date().toLocaleTimeString()}] [${level}] ${message}`;
            if (level === 'ERROR') line.style.color = '#ff5555';
            else if (level === 'WARN') line.style.color = '#ffb86c';

            overlay.appendChild(line);

            // Limit lines
            while (overlay.childNodes.length > 50) {
                overlay.firstChild?.remove();
            }

            // Auto scroll
            overlay.scrollTop = overlay.scrollHeight;
        }
    }

    /**
     * Clears the current log buffer and debug overlay.
     */
    public clear(): void {
        this._buffer = [];
        const overlay = document.getElementById('debug-overlay');
        if (overlay !== null) {
            overlay.innerHTML = '';
        }
    }

    /**
     * Retrieves all current logs in the buffer.
     */
    public getLogs(): ILogEntry[] {
        return [...this._buffer];
    }
}

/**
 * Global singleton instance of the LoggerService.
 */
export const logger = new LoggerService();
