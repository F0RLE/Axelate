import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { invokeSafe } from './invoke';

const invokeMock = vi.mocked(tauriInvoke);

describe('invokeSafe', () => {
    it('returns ok data from string commands', async () => {
        invokeMock.mockResolvedValueOnce({ version: '1.0.0' });

        const result = await invokeSafe('get_version', { verbose: true });

        expect(invokeMock).toHaveBeenCalledWith('get_version', { verbose: true });
        expect(result).toEqual({ status: 'ok', data: { version: '1.0.0' } });
    });

    it('returns ok data from specta results', async () => {
        const result = await invokeSafe(Promise.resolve({ status: 'ok', data: 42 }));

        expect(result).toEqual({ status: 'ok', data: 42 });
    });

    it('uses Error.message for transport exceptions', async () => {
        invokeMock.mockRejectedValueOnce(new Error('Download cancelled'));

        const result = await invokeSafe('download_module');

        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error.message).toBe('Download cancelled');
        }
    });

    it('uses string transport exceptions as messages', async () => {
        invokeMock.mockRejectedValueOnce('backend unavailable');

        const result = await invokeSafe('get_status');

        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error.code).toBe('INVOKE_EXCEPTION');
            expect(result.error.message).toBe('backend unavailable');
            expect(result.error.details).toBe('backend unavailable');
        }
    });

    it('uses structured transport error messages', async () => {
        invokeMock.mockRejectedValueOnce({ message: 'invalid payload', code: 'BAD_PAYLOAD' });

        const result = await invokeSafe('save_settings');

        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error.code).toBe('INVOKE_EXCEPTION');
            expect(result.error.message).toBe('invalid payload');
        }
    });

    it('preserves specta error codes and messages', async () => {
        const result = await invokeSafe(
            Promise.resolve({
                status: 'error',
                error: { code: 'RATE_LIMITED', message: 'Try later' },
            }),
        );

        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error.code).toBe('RATE_LIMITED');
            expect(result.error.message).toBe('Try later');
            expect(result.error.details).toEqual({ code: 'RATE_LIMITED', message: 'Try later' });
        }
    });

    it('stringifies structured payload errors from specta results', async () => {
        const result = await invokeSafe(
            Promise.resolve({
                status: 'error',
                error: { payload: { reason: 'rate limited' } },
            }),
        );

        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error.message).toBe('{"reason":"rate limited"}');
        }
    });

    it('passes string payload errors through directly', async () => {
        const result = await invokeSafe(
            Promise.resolve({
                status: 'error',
                error: { payload: 'plain payload error' },
            }),
        );

        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error.message).toBe('plain payload error');
        }
    });

    it('falls back to UNKNOWN and JSON for unstructured specta errors', async () => {
        const result = await invokeSafe(Promise.resolve({ status: 'error', error: { ok: false } }));

        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error.code).toBe('UNKNOWN');
            expect(result.error.message).toBe('{"ok":false}');
        }
    });

    it('falls back to String when error JSON serialization fails', async () => {
        const circular: Record<string, unknown> = {};
        circular['self'] = circular;

        const result = await invokeSafe(Promise.resolve({ status: 'error', error: circular }));

        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error.message).toBe('[object Object]');
        }
    });
});
