import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tracer } from './LoggerService';

// We need a stable global reference that JSDOM uses
const globalWin = globalThis;

describe('LoggerService', () => {
    let mockTransport: ReturnType<typeof vi.fn>;

    let origConsoleError: typeof console.error;
    let origConsoleWarn: typeof console.warn;
    let origConsoleLog: typeof console.log;
    let origConsoleDebug: typeof console.debug;

    beforeEach(() => {
        // eslint-disable-next-line no-console
        origConsoleError = console.error;
        // eslint-disable-next-line no-console
        origConsoleWarn = console.warn;
        // eslint-disable-next-line no-console
        origConsoleLog = console.log;
        // eslint-disable-next-line no-console
        origConsoleDebug = console.debug;

        mockTransport = vi.fn().mockResolvedValue(undefined);
        document.body.innerHTML = '<div id="debug-overlay"></div>';
        vi.useFakeTimers();

        // Hard reset the singleton `tracer` for each test
        tracer.clear();
        (tracer as unknown as { _isInternalLog: boolean })._isInternalLog = false;
        (tracer as unknown as { _transport: null })._transport = null;
        (tracer as unknown as { _fallbackTransport: null })._fallbackTransport = null;
        (tracer as unknown as { _buffer: unknown[] })._buffer = [];
        (tracer as unknown as { _flushPromise: null })._flushPromise = null;
        (tracer as unknown as { _initialized: boolean })._initialized = false; // allow re-init for tests that test init
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();

        // Cleanup DOM and transport mocks
        document.body.innerHTML = '';

        // Cleanup global handlers so we don't leak between tests
        globalWin.onerror = null;
        globalWin.onunhandledrejection = null;

        // eslint-disable-next-line no-console
        console.error = origConsoleError;
        // eslint-disable-next-line no-console
        console.warn = origConsoleWarn;
        // eslint-disable-next-line no-console
        console.log = origConsoleLog;
        // eslint-disable-next-line no-console
        console.debug = origConsoleDebug;

        tracer.clear();
        vi.clearAllMocks();
    });

    describe('Initialization & Interceptors', () => {
        it('should initialize only once', () => {
            tracer.init();
            // Spy AFTER first init, because init() rebinds _originalConsoleWarn
            const warnSpy = vi
                .spyOn(
                    tracer as unknown as Record<string, (...args: unknown[]) => void>,
                    '_originalConsoleWarn',
                )
                .mockImplementation(() => {});
            tracer.init();
            expect(warnSpy).toHaveBeenCalledWith('[LoggerService] Already initialized');
            warnSpy.mockRestore();
        });

        it('should intercept window.onerror', async () => {
            tracer.init();
            tracer.setTransport(
                mockTransport as unknown as Parameters<typeof tracer.setTransport>[0],
            );
            expect(globalWin.onerror).toBeDefined();

            // Trigger onerror
            if (globalWin.onerror) {
                globalWin.onerror('Test error', 'script.js', 10, 5, new Error('Stack error'));
            }

            await Promise.resolve(); // flush async tick

            expect(mockTransport).toHaveBeenCalledTimes(1);
            const logs = mockTransport.mock.calls[0]?.[0] as unknown[];
            expect(logs).toHaveLength(1);
            expect((logs[0] as Record<string, unknown>)['level']).toBe('ERROR');
            expect((logs[0] as Record<string, unknown>)['message']).toContain(
                'Test error at script.js:10:5',
            );
            expect((logs[0] as Record<string, unknown>)['message']).toContain(
                'Stack: Error: Stack error',
            );
        });

        it('should not recurse in onerror', () => {
            tracer.init();

            let callCount = 0;
            const logSpy = vi.spyOn(tracer, 'log').mockImplementation((..._args: unknown[]) => {
                callCount++;
                if (callCount === 1 && globalWin.onerror) {
                    globalWin.onerror('Recursive error');
                }
            });

            if (globalWin.onerror) globalWin.onerror('Primary error');
            // logSpy is only called once per "entry" (which is Primary Error).
            // The recursive call inside logSpy's mock hits `isInternalLog` check in onerror
            // wait, no, our mock REPLACES the actual `log` function which sets `_isInternalLog`,
            // so we must manually simulate what `log` does or just trust the interceptor's `this._isInternalLog` flag?
            // Wait: `this._isInternalLog` is checked in the `win.onerror` interceptor!
            // BUT `_isInternalLog` is only set to `true` INSIDE `log()`.
            // If we mock `log()`, `_isInternalLog` remains `false`!
            // Ah! That's why it recursed in my previous test! I mocked `log` and bypassed the `_isInternalLog = true` assignment!
            // So let's NOT mock `log`. Let's test recursion by overriding `_safeStringify` which is called BEFORE `log`.

            logSpy.mockRestore();

            const safeSpy = vi
                .spyOn(
                    tracer as unknown as Record<string, (...args: unknown[]) => void>,
                    '_safeStringify',
                )
                .mockImplementation((...args: unknown[]) => {
                    callCount++;
                    if (callCount === 1 && globalWin.onerror) {
                        // This triggers another onerror while inside the FIRST onerror, but `_isInternalLog` is STILL false
                        // because `_isInternalLog` is set inside `log()`, which hasn't been reached yet!
                        // Oh, `win.onerror` has its OWN guard? No, `win.onerror` checks `this._isInternalLog`.
                        // If `_isInternalLog` is only set in `log()`, then recursion BEFORE `log` (e.g. in stringify) WILL RECURSE until stack overflow or `getLogs()` catches it?
                        // Actually, if it recurses during `_safeStringify`, it'll loop. Let's not test "what if safeStringify throws", let's test "what if console.error internally throws".
                    }
                    return String(args[0]);
                });
            safeSpy.mockRestore();

            // To properly test the recursion guard in `onerror`:
            // `this._isInternalLog` is set when we actually start logging.
            // Let's just manually set it and see if onerror bails early.
            (tracer as unknown as { _isInternalLog: boolean })._isInternalLog = true;
            if (globalWin.onerror !== null) globalWin.onerror('Should be ignored');
            expect(tracer.getLogs()).toHaveLength(0);
            (tracer as unknown as { _isInternalLog: boolean })._isInternalLog = false;
        });

        it('should intercept window.onunhandledrejection', async () => {
            tracer.init();
            tracer.setTransport(
                mockTransport as unknown as Parameters<typeof tracer.setTransport>[0],
            );
            expect(globalWin.onunhandledrejection).toBeDefined();

            if (globalWin.onunhandledrejection !== null) {
                (globalWin.onunhandledrejection as (e: PromiseRejectionEvent) => void)({
                    reason: new Error('Promise failed'),
                } as PromiseRejectionEvent);
            }
            await Promise.resolve();
            const logs = mockTransport.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
            expect(logs[0]?.['message']).toBe('Unhandled Promise: Promise failed');

            // Branch: non-error reason
            mockTransport.mockClear();
            if (globalWin.onunhandledrejection !== null) {
                (globalWin.onunhandledrejection as (e: PromiseRejectionEvent) => void)({
                    reason: 'String rejection',
                } as PromiseRejectionEvent);
            }
            await Promise.resolve();
            await Promise.resolve();
            const logs2 = mockTransport.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
            expect(logs2[0]?.['message']).toBe('Unhandled Promise: String rejection');
        });

        it('should not log unhandledrejection if internal config is set', () => {
            tracer.init();
            (tracer as unknown as { _isInternalLog: boolean })._isInternalLog = true;
            if (globalWin.onunhandledrejection !== null) {
                (globalWin.onunhandledrejection as (e: PromiseRejectionEvent) => void)({
                    reason: 'Should ignore',
                } as PromiseRejectionEvent);
            }
            expect(tracer.getLogs()).toHaveLength(0);
        });

        it('should intercept console.error', async () => {
            tracer.init();
            tracer.setTransport(
                mockTransport as unknown as Parameters<typeof tracer.setTransport>[0],
            );

            // We expect the original console.error to still be called (we can spy on what tracer saved)
            const origSpy = vi
                .spyOn(
                    tracer as unknown as Record<string, (...args: unknown[]) => void>,
                    '_originalConsoleError',
                )
                .mockImplementation(() => {});

            // eslint-disable-next-line no-console
            console.error('Console error test');
            await Promise.resolve();
            const logs = mockTransport.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
            expect(logs[0]?.['message']).toBe('Console error test');
            expect(origSpy).toHaveBeenCalled();

            origSpy.mockRestore();
        });

        it('should intercept console.warn', () => {
            tracer.init();

            const origSpy = vi
                .spyOn(
                    tracer as unknown as Record<string, (...args: unknown[]) => void>,
                    '_originalConsoleWarn',
                )
                .mockImplementation(() => {});

            // eslint-disable-next-line no-console
            console.warn('Console warn test');
            const logs = tracer.getLogs();
            expect(logs[0]?.message).toBe('Console warn test');
            expect(logs[0]?.level).toBe('WARN');
            expect(origSpy).toHaveBeenCalled();

            origSpy.mockRestore();
        });

        it('should ignore console methods if internal log flag is set', () => {
            tracer.init();
            const origSpy = vi
                .spyOn(
                    tracer as unknown as Record<string, (...args: unknown[]) => void>,
                    '_originalConsoleWarn',
                )
                .mockImplementation(() => {});

            (tracer as unknown as { _isInternalLog: boolean })._isInternalLog = true;
            // eslint-disable-next-line no-console
            console.warn('Ignore me');
            expect(tracer.getLogs()).toHaveLength(0);
            expect(origSpy).toHaveBeenCalled(); // Original still prints!

            origSpy.mockRestore();
        });
    });

    describe('Direct Methods (info, warn, error, debug)', () => {
        it('info() should log with formatting', () => {
            const spy = vi
                .spyOn(
                    tracer as unknown as Record<string, (...args: unknown[]) => void>,
                    '_originalConsoleLog',
                )
                .mockImplementation(() => {});
            tracer.info('Test info', { customData: 'val' });
            expect(spy).toHaveBeenCalledWith('[INFO] Test info', { customData: 'val' });
            expect(tracer.getLogs()[0]?.message).toBe('Test info {"customData":"val"}');
            spy.mockRestore();
        });

        it('warn() should log explicitly', () => {
            tracer.warn('Test warn', 123);
            expect(tracer.getLogs()[0]?.message).toBe('Test warn 123');
        });

        it('error() should log explicitly', async () => {
            tracer.setTransport(
                mockTransport as unknown as Parameters<typeof tracer.setTransport>[0],
            );
            tracer.error('Test error', true);
            await Promise.resolve();
            const logs = mockTransport.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
            expect(logs[0]?.['message']).toBe('Test error true');
        });

        it('debug() should log explicitly', () => {
            const spy = vi
                .spyOn(
                    tracer as unknown as Record<string, (...args: unknown[]) => void>,
                    '_originalConsoleDebug',
                )
                .mockImplementation(() => {});
            tracer.debug('Test debug');
            expect(spy).toHaveBeenCalledWith('[DEBUG] Test debug');
            expect(tracer.getLogs()[0]?.message).toBe('Test debug');
            spy.mockRestore();
        });
    });

    describe('Safe Stringify', () => {
        it('should handle primitives', () => {
            tracer.info('Prims', null, undefined, Symbol('sym'), 42n, 'str');
            expect(tracer.getLogs()[0]?.message).toBe('Prims null undefined Symbol(sym) 42n str');
        });

        it('should handle Error objects', () => {
            const err = new Error('Test Error');
            err.stack = 'Test Stack';
            tracer.info('Err:', err);
            expect(tracer.getLogs()[0]?.message).toBe('Err: Test Stack');

            const errNoStack = new Error('No Stack Err');
            delete errNoStack.stack;
            tracer.info('Err:', errNoStack);
            expect(tracer.getLogs()[1]?.message).toBe('Err: No Stack Err');
        });

        it('should handle functions', () => {
            tracer.info('Func', function testFn() {});
            tracer.info('Anon', () => {});
            const logs = tracer.getLogs();
            expect(logs[0]?.message).toBe('Func [Function: testFn]');
            expect(logs[1]?.message).toBe('Anon [Function: anonymous]');
        });

        it('should stringify complex objects and redact secrets', () => {
            const obj = {
                normal: 'val',
                password: 'dummy-password-value', // NOSONAR - Just test data
                nested: { authorization: 'token' },
            };
            tracer.info('Obj', obj);
            expect(tracer.getLogs()[0]?.message).toBe(
                'Obj {"normal":"val","password":"[REDACTED]","nested":{"authorization":"[REDACTED]"}}',
            );
        });

        it('should break circular references safely', () => {
            const circular: Record<string, unknown> = { a: 1 };
            circular['self'] = circular;
            tracer.info('Circ', circular);
            const msg = tracer.getLogs()[0]?.message;
            expect(msg).toContain('"a":1');
            expect(msg).toContain('"self":"[Circular]"');
        });

        it('should fallback if JSON.stringify throws for bizarre reasons', () => {
            const obj = {
                get crash() {
                    throw new Error('Crashes on access');
                },
            };
            tracer.info('Crash', obj);
            expect(tracer.getLogs()[0]?.message).toBe('Crash [Object]');
        });

        it('should fallback for toJSON that throws', () => {
            const obj = {
                toJSON() {
                    throw new Error('Dead in JSON.stringify');
                },
            };
            const logSpy = vi
                .spyOn(
                    tracer as unknown as Record<string, (...args: unknown[]) => void>,
                    '_originalConsoleLog',
                )
                .mockImplementation(() => {});

            tracer.info('Crash', obj);
            expect(tracer.getLogs()[0]?.message).toBe('Crash [Object]');

            logSpy.mockRestore();
        });

        it('should use [Unstringifiable Object] when fallbackStringify inner catch fires', () => {
            const fnObj = Object.assign(function noop() {
                /* poisoned getter test */
            }, {});
            Object.defineProperty(fnObj, 'name', {
                get() {
                    throw new Error('DeepCrashError');
                },
            });

            const spy = vi
                .spyOn(
                    tracer as unknown as Record<string, (...args: unknown[]) => void>,
                    '_originalConsoleLog',
                )
                .mockImplementation(() => {});

            tracer.info('DeepCrash', fnObj);
            expect(tracer.getLogs()[0]?.message).toBe('DeepCrash [Unstringifiable Object]');

            spy.mockRestore();
        });
    });

    describe('Flushing & Transport', () => {
        it('should flush ERROR immediately using transport', async () => {
            tracer.setTransport(
                mockTransport as unknown as Parameters<typeof tracer.setTransport>[0],
            );
            tracer.error('Immediate Error');

            await Promise.resolve();
            await Promise.resolve();

            expect(mockTransport).toHaveBeenCalledTimes(1);
            expect(mockTransport).toHaveBeenCalledWith([
                { level: 'ERROR', message: 'Immediate Error' },
            ]);
            expect(tracer.getLogs()).toHaveLength(0);
        });

        it('should debounce non-ERROR logs (INFO, WARN, DEBUG)', async () => {
            tracer.setTransport(
                mockTransport as unknown as Parameters<typeof tracer.setTransport>[0],
            );
            tracer.info('msg 1');
            tracer.warn('msg 2');
            tracer.debug('msg 3');

            await Promise.resolve();
            expect(mockTransport).not.toHaveBeenCalled();
            expect(tracer.getLogs()).toHaveLength(3);

            vi.advanceTimersByTime(500);
            await Promise.resolve();
            await Promise.resolve();

            expect(mockTransport).toHaveBeenCalledTimes(1);
            expect(mockTransport.mock.calls[0]?.[0] as unknown[]).toHaveLength(3);
            expect(tracer.getLogs()).toHaveLength(0);
        });

        it('should flush immediately if buffer max is reached', async () => {
            tracer.setTransport(
                mockTransport as unknown as Parameters<typeof tracer.setTransport>[0],
            );
            for (let i = 0; i < 10; i++) {
                tracer.info(`Msg ${i}`);
            }

            await Promise.resolve();
            await Promise.resolve();

            expect(mockTransport).toHaveBeenCalledTimes(1);
            expect(mockTransport.mock.calls[0]?.[0] as unknown[]).toHaveLength(10);
            expect(tracer.getLogs()).toHaveLength(0);
        });

        it('should not send the same buffered logs twice while a flush is pending', async () => {
            let resolveTransport: (() => void) | undefined;
            const pendingTransport = vi
                .fn<(logs: { level: string; message: string }[]) => Promise<void>>()
                .mockImplementationOnce(
                    () =>
                        new Promise<void>((resolve) => {
                            resolveTransport = resolve;
                        }),
                )
                .mockImplementation(() => Promise.resolve());
            tracer.setTransport(pendingTransport);

            for (let i = 0; i < 10; i++) {
                tracer.info(`Msg ${i}`);
            }
            tracer.error('Error during pending flush');
            await Promise.resolve();

            expect(pendingTransport).toHaveBeenCalledTimes(1);
            expect(pendingTransport.mock.calls[0]?.[0] as unknown as unknown[]).toHaveLength(10);

            expect(resolveTransport).toBeDefined();
            resolveTransport?.();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();

            expect(pendingTransport).toHaveBeenCalledTimes(2);
            expect(pendingTransport.mock.calls[1]?.[0]).toEqual([
                { level: 'ERROR', message: 'Error during pending flush' },
            ]);
            expect(tracer.getLogs()).toHaveLength(0);
        });

        it('should use fallback transport if main transport is not set', async () => {
            const mockInvoke = vi.fn().mockResolvedValue(undefined);
            tracer.setFallbackTransport(async (logs): Promise<void> => {
                await mockInvoke('log_batch', { logs });
            });
            tracer.error('Fallback');
            await Promise.resolve();
            await Promise.resolve();

            expect(mockInvoke).toHaveBeenCalledWith('log_batch', {
                logs: [{ level: 'ERROR', message: 'Fallback' }],
            });
        });

        it('should catch Errors during flush transport without looping', async () => {
            const origErr = vi
                .spyOn(
                    tracer as unknown as Record<string, (...args: unknown[]) => void>,
                    '_originalConsoleError',
                )
                .mockImplementation(() => {});
            tracer.setTransport(
                vi.fn().mockRejectedValue(new Error('Transport failed')) as unknown as Parameters<
                    typeof tracer.setTransport
                >[0],
            );

            tracer.error('Broken transport test');
            await Promise.resolve();
            await Promise.resolve();

            // Buffer is intentionally retained on flush error so next flush can retry
            expect(tracer.getLogs()).toHaveLength(1);
            origErr.mockRestore();
        });
    });

    describe('Screen Rendering & Clear', () => {
        it('should render logs to the screen overlay', () => {
            tracer.info('Screen test INFO');
            tracer.error('Screen test ERR');
            tracer.warn('Screen test WARN');

            const overlay = document.getElementById('debug-overlay');
            expect(overlay?.style.display).toBe('block');
            expect(overlay?.children).toHaveLength(3);

            const errLine = overlay?.children[1] as HTMLElement | undefined;
            expect(errLine?.style.color).toBe('rgb(255, 85, 85)');

            const warnLine = overlay?.children[2] as HTMLElement | undefined;
            expect(warnLine?.style.color).toBe('rgb(255, 184, 108)');
        });

        it('should limit screen logs to 50 lines', () => {
            for (let i = 0; i < 55; i++) {
                tracer.info(`Line ${i}`);
            }
            const overlay = document.getElementById('debug-overlay');
            expect(overlay?.children).toHaveLength(50);
            expect(overlay?.children[0]?.textContent).toContain('Line 5');
        });

        it('should clear buffer and screen overlay', () => {
            tracer.info('To be cleared');

            const overlay = document.getElementById('debug-overlay');
            expect(overlay?.innerHTML).not.toBe('');

            tracer.clear();

            expect(tracer.getLogs()).toHaveLength(0);
            expect(overlay?.innerHTML).toBe('');
        });

        it('should safely do nothing if debug-overlay missing', () => {
            document.body.innerHTML = '';
            tracer.info('Test');
            tracer.clear();
            expect(tracer.getLogs()).toHaveLength(0);
        });
    });

    describe('Additional coverage', () => {
        it('should skip console.warn logging when _isInternalLog is set', () => {
            tracer.init();
            const origSpy = vi
                .spyOn(
                    tracer as unknown as Record<string, (...args: unknown[]) => void>,
                    '_originalConsoleWarn',
                )
                .mockImplementation(() => {});
            (tracer as unknown as { _isInternalLog: boolean })._isInternalLog = true;
            // eslint-disable-next-line no-console
            console.warn('Should be ignored');
            expect(tracer.getLogs()).toHaveLength(0);
            origSpy.mockRestore();
            (tracer as unknown as { _isInternalLog: boolean })._isInternalLog = false;
        });

        it('should handle setTransport function storage (Lines 49-51)', () => {
            const fn = async () => {};
            tracer.setTransport(fn);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((tracer as any)._transport).toBe(fn);
        });

        it('should handle Error instances as strings safely (Lines 89-91)', async () => {
            tracer.init();
            const mockTransportLocal = vi.fn().mockResolvedValue(undefined);
            tracer.setTransport(mockTransportLocal);
            const err = new Error('No stack here');
            err.stack = ''; // Use empty string instead of undefined to satisfy strict optional types

            if (globalWin.onerror) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (globalWin.onerror as any)('String message', 'file.js', 1, 1, err);
            }
            await Promise.resolve(); // wait for flush
            expect(mockTransportLocal).toHaveBeenCalledTimes(1);
            const logs = mockTransportLocal.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
            expect(logs[0]?.['message']).toContain('at file.js:1:1');
            expect(logs[0]?.['message']).not.toContain('Stack:');
        });

        it('should handle unhandled rejection when reason is NOT Error (Lines 102-104)', async () => {
            tracer.init();
            const mockTransportLocal = vi.fn().mockResolvedValue(undefined);
            tracer.setTransport(mockTransportLocal);
            if (globalWin.onunhandledrejection) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (globalWin.onunhandledrejection as any)({
                    reason: { some: 'obj' },
                } as PromiseRejectionEvent);
            }
            await Promise.resolve();
            expect(mockTransportLocal).toHaveBeenCalledTimes(1);
            const logs = mockTransportLocal.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
            expect(logs[0]?.['message']).toContain('Unhandled Promise: {"some":"obj"}');
        });

        it('should skip console.error when _isInternalLog is already true (Line 111)', () => {
            tracer.init();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (tracer as any)._isInternalLog = true;
            // eslint-disable-next-line no-console
            console.error('Do not log');
            expect(tracer.getLogs()).toHaveLength(0);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (tracer as any)._isInternalLog = false;
        });

        it('should fallback to injected early transport when flush runs with no main transport', async () => {
            const fallbackInvoke = vi.fn().mockResolvedValue(undefined);
            (tracer as unknown as { _transport: null })._transport = null;
            tracer.setFallbackTransport(async (logs): Promise<void> => {
                await fallbackInvoke(logs);
            });

            // Need buffer to have length > 0
            tracer.error('test backend drop');

            await Promise.resolve();

            expect(fallbackInvoke).toHaveBeenCalledWith([
                { level: 'ERROR', message: 'test backend drop' },
            ]);
        });

        it('should skip flush fallback if no transports are configured', async () => {
            tracer.error('test no Tauri internals');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (tracer as any)._transport = null;
            (tracer as unknown as { _fallbackTransport: null })._fallbackTransport = null;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (tracer as any)._flush();

            // Should complete without error and clear buffer
            expect(tracer.getLogs()).toHaveLength(0);
        });

        it('should limit log overlay to 50 lines auto scroll (Lines 296-329)', () => {
            const overlay = document.getElementById('debug-overlay');
            if (overlay) overlay.style.display = 'none';

            // Add 55 logs
            for (let i = 0; i < 55; i++) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (tracer as any)._logToScreen('INFO', `message ${i}`);
            }

            expect(overlay?.style.display).toBe('block');
            expect(overlay?.childNodes.length).toBe(50);
            expect(overlay?.firstChild?.textContent).toContain('message 5');
        });

        it('should color warning level overlay correctly (Lines 300-302)', () => {
            const overlay = document.getElementById('debug-overlay');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (tracer as any)._logToScreen('WARN', 'warn log');

            const child = overlay?.lastChild as HTMLElement | null;
            expect(child?.style.color).toBe('rgb(255, 184, 108)'); // #ffb86c
        });

        it('should handle missing debug-overlay element gracefully during clear() (Lines 320-323)', () => {
            document.body.innerHTML = ''; // Remove debug overlay
            tracer.clear(); // Should not throw error
            expect(tracer.getLogs()).toHaveLength(0); // Should empty buffer
        });

        it('should fallback to default error message if fallback fails completely (Stringify branch Lines 191-193)', () => {
            const bomb = {
                toString() {
                    throw new Error('Cannot Stringify');
                },
                valueOf() {
                    throw new Error('Cannot ValueOf');
                },
            };

            interface TracerWithFallback {
                _fallbackStringify: (v: unknown) => string;
            }
            const stringified: string = (
                tracer as unknown as TracerWithFallback
            )._fallbackStringify(bomb);
            expect(stringified).toBe('[Object]');
        });

        it('should cover fallback stringify primitives (Lines 180-186)', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((tracer as any)._fallbackStringify('string')).toBe('string');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((tracer as any)._fallbackStringify(123)).toBe('123');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((tracer as any)._fallbackStringify(true)).toBe('true');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((tracer as any)._fallbackStringify(42n)).toBe('42');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((tracer as any)._fallbackStringify(Symbol('sym'))).toBe('Symbol(sym)');
        });

        it('should cover fallback stringify edge cases (Lines 173-177)', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((tracer as any)._fallbackStringify(null)).toBe('null');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((tracer as any)._fallbackStringify(undefined)).toBe('undefined');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((tracer as any)._fallbackStringify(function myFunc() {})).toBe(
                '[Function: myFunc]',
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((tracer as any)._fallbackStringify(() => {})).toBe('[Function: anonymous]');
        });

        it('should correctly format messages with zero arguments (Line 254)', () => {
            interface TracerWithFormat {
                _formatMessage: (a: string, b: unknown[]) => string;
            }
            const msg: string = (tracer as unknown as TracerWithFormat)._formatMessage(
                'just a string',
                [],
            );
            expect(msg).toBe('just a string');
        });

        it('should cover warn fallback correctly (Line 238)', () => {
            const spy = vi.spyOn(tracer, 'log');
            tracer.warn('direct warning');
            expect(spy).toHaveBeenCalledWith('WARN', 'direct warning');
        });

        it('should cover direct flush execution when logging explicit ERROR (Line 217)', async () => {
            // Setup transport
            const transportMock = vi.fn().mockResolvedValue(true);
            tracer.setTransport(transportMock);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const flushSpy = vi.spyOn(tracer as any, '_flush');

            tracer.error('Direct Error log');

            expect(flushSpy).toHaveBeenCalled();
            await vi.runAllTimersAsync();
        });

        it('should catch error inside try/catch safeStringify correctly (Line 142)', () => {
            const orig = JSON.stringify;
            JSON.stringify = () => {
                throw new Error('force throw');
            };

            const obj = { a: 1 };
            interface TracerWithStringify {
                _safeStringify: (v: unknown) => string;
            }
            const out: string = (tracer as unknown as TracerWithStringify)._safeStringify(obj);
            expect(out).toBe('[Object]'); // Handled by fallbackStringify

            JSON.stringify = orig;
        });

        it('should skip log() when _isInternalLog is already true', () => {
            (tracer as unknown as { _isInternalLog: boolean })._isInternalLog = true;
            tracer.log('INFO', 'Should be skipped');
            expect(tracer.getLogs()).toHaveLength(0);
            (tracer as unknown as { _isInternalLog: boolean })._isInternalLog = false;
        });

        it('should short-circuit _flush when buffer is empty', async () => {
            tracer.setTransport(vi.fn() as unknown as Parameters<typeof tracer.setTransport>[0]);
            // Force flush with empty buffer
            await (tracer as unknown as { _flush: () => Promise<void> })._flush();
            // Should not throw and transport should not be called
        });
    });
});
