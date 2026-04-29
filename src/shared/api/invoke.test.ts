import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { invokeSafe } from './invoke';

const invokeMock = vi.mocked(tauriInvoke);

describe('invokeSafe', () => {
    it('uses Error.message for transport exceptions', async () => {
        invokeMock.mockRejectedValueOnce(new Error('Download cancelled'));

        const result = await invokeSafe('download_module');

        expect(result.status).toBe('error');
        if (result.status === 'error') {
            expect(result.error.message).toBe('Download cancelled');
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
});
