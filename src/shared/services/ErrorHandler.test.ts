import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { errorHandler } from '@/shared/services/ErrorHandler';

describe('ErrorHandler', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
            /* no-op */
        });
        // Clear error log before each test
        errorHandler.clearErrorLog();
    });

    afterEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        consoleSpy.mockRestore();
    });

    describe('captureError', () => {
        it('should log error to console', () => {
            const error = new Error('Test error');
            errorHandler.captureError(error, 'test-context');

            expect(consoleSpy).toHaveBeenCalled();
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
            // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
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
    });
});
