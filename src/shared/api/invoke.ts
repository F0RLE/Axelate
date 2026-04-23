import { invoke } from '@tauri-apps/api/core';
import type { Result } from './types';

/**
 * Type-safe wrapper for Tauri invoke commands.
 */
/**
 * Type-safe wrapper for Tauri invoke commands or Specta promises.
 */
export async function invokeSafe<T, E = unknown>(
    cmdOrPromise: string | Promise<{ status: 'ok'; data: T } | { status: 'error'; error: E }>,
    args?: Record<string, unknown>,
): Promise<Result<T>> {
    try {
        if (typeof cmdOrPromise === 'string') {
            const data = await invoke<T>(cmdOrPromise, args);
            return { status: 'ok', data };
        } else {
            const result = await cmdOrPromise;
            if (result.status === 'ok') {
                return { status: 'ok', data: result.data };
            } else {
                const err = result.error as Record<string, unknown>;
                return {
                    status: 'error',
                    error: {
                        code: typeof err['code'] === 'string' ? err['code'] : 'UNKNOWN',
                        message:
                            typeof err['message'] === 'string'
                                ? err['message']
                                : String(result.error),
                        details: result.error,
                    },
                };
            }
        }
    } catch (err) {
        // Handle unexpected errors (e.g. transport)
        return {
            status: 'error',
            error: { code: 'INVOKE_EXCEPTION', message: String(err), details: err },
        };
    }
}

/**
 * Helper to use with tauri-specta generated commands if needed,
 * or as a pattern for our own service methods.
 */
