import { invoke } from '@tauri-apps/api/core';
import type { Result } from './types';

/**
 * Type-safe wrapper for Tauri invoke commands.
 */
/**
 * Overload 1: Raw string invoke (legacy/manual)
 */
export async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<Result<T>>;

/**
 * Overload 2: Wrapping a tauri-specta command promise
 */
export async function invokeSafe<T, E>(promise: Promise<{ status: 'ok', data: T } | { status: 'error', error: E }>): Promise<Result<T>>;

export async function invokeSafe<T, E>(
    cmdOrPromise: string | Promise<{ status: 'ok', data: T } | { status: 'error', error: E }>,
    args?: Record<string, unknown>
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
                return {
                    status: 'error',
                    error: {
                        code: (result.error as any).code || 'UNKNOWN',
                        message: (result.error as any).message || String(result.error),
                        details: result.error
                    }
                };
            }
        }
    } catch (err) {
        // Handle unexpected errors (e.g. transport)
        return {
             status: 'error',
             error: { code: 'INVOKE_EXCEPTION', message: String(err), details: err }
        };
    }
}

/**
 * Helper to use with tauri-specta generated commands if needed,
 * or as a pattern for our own service methods.
 */
