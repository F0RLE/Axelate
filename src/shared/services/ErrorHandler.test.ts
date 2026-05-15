import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorHandler } from '@/shared/services/ErrorHandler';
import { EventBus } from '@/shared/services/EventBus';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

describe('ErrorHandler', () => {
    let errorHandler: ErrorHandler;
    let testEventBus: EventBus;
    let tracer: Pick<LoggerService, 'debug' | 'warn' | 'error'>;

    const resetHandler = () => {
        errorHandler.destroy();
        errorHandler = new ErrorHandler({ eventBus: testEventBus, tracer });
        errorHandler.init();
        errorHandler.clearErrorLog();
    };

    beforeEach(() => {
        testEventBus = new EventBus();
        tracer = {
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        errorHandler = new ErrorHandler({ eventBus: testEventBus, tracer });
        resetHandler();
    });

    afterEach(() => {
        errorHandler.destroy();
    });

    describe('captureError', () => {
        it('should log error using tracer', () => {
            const error = new Error('Test error');
            errorHandler.captureError(error, 'test-context');

            expect(tracer.error).toHaveBeenCalled();
        });

        it('should add error to error log', () => {
            const error = new Error('Test error');
            errorHandler.captureError(error, 'test-context');

            const log = errorHandler.getErrorLog();
            expect(log.length).toBe(1);
            expect(log[0]?.message).toBe('Test error');
            expect(log[0]?.context).toBe('test-context');
        });

        it('should include timestamp in error info', () => {
            const beforeTime = Date.now();
            const error = new Error('Test error');
            errorHandler.captureError(error);
            const afterTime = Date.now();

            const log = errorHandler.getErrorLog();
            expect(log[0]?.timestamp).toBeGreaterThanOrEqual(beforeTime);
            expect(log[0]?.timestamp).toBeLessThanOrEqual(afterTime);
        });
    });

    describe('onError callback', () => {
        it('should call registered callback when error is captured', () => {
            const callback = vi.fn();
            const unsubscribe = errorHandler.onError(callback);

            const error = new Error('Test error');
            errorHandler.captureError(error);

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Test error',
                }),
            );

            unsubscribe();
        });

        it('should not call callback after unsubscribe', () => {
            const callback = vi.fn();
            const unsubscribe = errorHandler.onError(callback);

            unsubscribe();

            const error = new Error('Test error');
            errorHandler.captureError(error);

            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('clearErrorLog', () => {
        it('should clear error log', () => {
            errorHandler.captureError(new Error('Test 1'));
            errorHandler.captureError(new Error('Test 2'));

            expect(errorHandler.getErrorLog().length).toBe(2);

            errorHandler.clearErrorLog();

            expect(errorHandler.getErrorLog().length).toBe(0);
        });
    });

    describe('wrapAsync', () => {
        it('should return result on success', async () => {
            const result = await errorHandler.wrapAsync(
                () => Promise.resolve('success'),
                'test-context',
            );

            expect(result).toBe('success');
        });

        it('should capture error and return undefined on failure', async () => {
            const result = await errorHandler.wrapAsync(async () => {
                await Promise.resolve(); // Ensure async
                throw new Error('Async error');
            }, 'async-context');

            expect(result).toBeUndefined();
            expect(errorHandler.getErrorLog().length).toBe(1);
            expect(errorHandler.getErrorLog()[0]?.context).toBe('async-context');
        });
    });

    describe('safeHandler', () => {
        it('should call original handler', () => {
            const handler = vi.fn();
            const safe = errorHandler.safeHandler(handler);

            const mockEvent = new Event('click');
            safe(mockEvent);

            expect(handler).toHaveBeenCalledWith(mockEvent);
        });

        it('should capture error if handler throws', () => {
            const handler = vi.fn(() => {
                throw new Error('Handler error');
            });
            const safe = errorHandler.safeHandler(handler, 'click-handler');

            const mockEvent = new Event('click');
            // Should not throw
            safe(mockEvent);

            expect(errorHandler.getErrorLog().length).toBe(1);
            expect(errorHandler.getErrorLog()[0]?.context).toBe('click-handler');
        });

        it('should use "eventHandler" as default context (L207)', () => {
            const handler = vi.fn(() => {
                throw new Error('No context error');
            });
            const safe = errorHandler.safeHandler(handler);
            safe(new Event('click'));

            const log = errorHandler.getErrorLog();
            expect(log.at(-1)?.context).toBe('eventHandler');
        });
    });

    describe('wrapAsync edge cases', () => {
        it('should handle non-Error throw with no context (L189)', async () => {
            const result = await errorHandler.wrapAsync(async () => {
                await Promise.resolve();
                throw 42; // eslint-disable-line no-throw-literal, @typescript-eslint/only-throw-error
            });

            expect(result).toBeUndefined();
            const log = errorHandler.getErrorLog();
            expect(log.at(-1)?.message).toBe('42');
        });
    });

    describe('init', () => {
        it('should set up global error handlers', () => {
            resetHandler();
            expect(typeof globalThis.onerror).toBe('function');
            expect(typeof globalThis.onunhandledrejection).toBe('function');
        });

        it('should skip if already initialized', () => {
            errorHandler.init();
            errorHandler.init();
            expect(tracer.warn).toHaveBeenCalledWith(
                expect.stringContaining('Already initialized'),
            );
        });

        it('should handle onerror with source and line info', () => {
            resetHandler();

            if (globalThis.onerror !== null) {
                globalThis.onerror('Test message', 'test.js', 42, 10, new Error('onerror'));
            }
            const log = errorHandler.getErrorLog();
            expect(log.length).toBeGreaterThanOrEqual(1);
            expect(log[0]?.url).toBe('test.js');
            expect(log[0]?.line).toBe(42);
        });

        it('should handle onerror without error object', () => {
            resetHandler();

            if (globalThis.onerror !== null) {
                (
                    globalThis.onerror as (
                        msg: string,
                        src?: string,
                        line?: number,
                        col?: number,
                        err?: Error,
                    ) => void
                )('Raw string message', undefined, undefined, undefined, undefined);
            }
            expect(errorHandler.getErrorLog().length).toBeGreaterThanOrEqual(1);
        });

        it('should handle onunhandledrejection', () => {
            resetHandler();

            if (globalThis.onunhandledrejection !== null) {
                (globalThis.onunhandledrejection as (e: PromiseRejectionEvent) => void)({
                    reason: new Error('Promise rejected'),
                } as PromiseRejectionEvent);
            }
            expect(errorHandler.getErrorLog().length).toBeGreaterThanOrEqual(1);
        });

        it('should handle onunhandledrejection with non-Error reason', () => {
            resetHandler();

            if (globalThis.onunhandledrejection !== null) {
                (globalThis.onunhandledrejection as (e: PromiseRejectionEvent) => void)({
                    reason: 'string rejection',
                } as PromiseRejectionEvent);
            }
            expect(errorHandler.getErrorLog().length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('_showErrorToast', () => {
        it('should create toast when container exists', () => {
            vi.useFakeTimers();
            document.body.innerHTML = '<div id="toast-container"></div>';
            errorHandler.captureError(new Error('Toast test'));
            const container = document.getElementById('toast-container');
            expect(container?.children.length).toBeGreaterThanOrEqual(1);
            vi.advanceTimersByTime(5500);
            vi.useRealTimers();
            document.body.innerHTML = '';
        });

        it('should render toast message as text, not HTML', () => {
            document.body.innerHTML = '<div id="toast-container"></div>';
            errorHandler.captureError(new Error('<img src=x onerror=alert(1)>'));

            const toastMessage = document.querySelector('.toast-message');
            expect(toastMessage?.textContent).toBe('<img src=x onerror=alert(1)>');
            expect(document.querySelector('.toast-message img')).toBeNull();
        });

        it('should skip toast when no container', () => {
            document.body.innerHTML = '';
            expect(() => errorHandler.captureError(new Error('No toast'))).not.toThrow();
        });
    });

    describe('error log max size', () => {
        it('should truncate log at 100 entries', () => {
            for (let i = 0; i < 105; i++) {
                errorHandler.captureError(new Error(`Error ${i}`));
            }
            expect(errorHandler.getErrorLog().length).toBeLessThanOrEqual(100);
        });
    });

    describe('captureError with extra', () => {
        it('should include url, line, column from extra', () => {
            errorHandler.captureError(new Error('full'), 'ctx', {
                url: 'file.ts',
                line: 10,
                column: 5,
            });
            const log = errorHandler.getErrorLog();
            const entry = log.at(-1);
            expect(entry?.url).toBe('file.ts');
            expect(entry?.line).toBe(10);
            expect(entry?.column).toBe(5);
        });
    });

    describe('callback error handling', () => {
        it('should catch errors in onError callbacks', () => {
            const badCb = vi.fn(() => {
                throw new Error('Callback crash');
            });
            errorHandler.onError(badCb);
            expect(() => errorHandler.captureError(new Error('trigger'))).not.toThrow();
        });
    });

    describe('edge branches', () => {
        it('should handle onerror with object message (L60)', () => {
            resetHandler();

            if (globalThis.onerror !== null) {
                (
                    globalThis.onerror as (
                        msg: unknown,
                        src?: string,
                        line?: number,
                        col?: number,
                        err?: Error,
                    ) => void
                )({ complex: 'object' }, undefined, undefined, undefined, undefined);
            }
            expect(errorHandler.getErrorLog().length).toBeGreaterThanOrEqual(1);
        });

        it('should handle captureError with error without stack (L91)', () => {
            const err = new Error('no-stack');
            delete (err as unknown as Record<string, unknown>)['stack'];
            errorHandler.captureError(err, 'ctx');
            const log = errorHandler.getErrorLog();
            expect(log.at(-1)?.stack).toBeUndefined();
        });

        it('should handle safeHandler when handler throws non-Error (L189-207)', () => {
            const handler = vi.fn(() => {
                throw 'string-error'; // eslint-disable-line no-throw-literal, @typescript-eslint/only-throw-error
            });
            const safe = errorHandler.safeHandler(handler, 'ctx');
            safe(new Event('click'));
            const log = errorHandler.getErrorLog();
            expect(log.at(-1)?.message).toBe('string-error');
        });
    });
});
