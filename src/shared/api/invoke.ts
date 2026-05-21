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
                return {
                    status: 'error',
                    error: {
                        code: getInvokeErrorCode(result.error),
                        message: getInvokeErrorMessage(result.error),
                        details: result.error,
                    },
                };
            }
        }
    } catch (err) {
        // Handle unexpected errors (e.g. transport)
        return {
            status: 'error',
            error: {
                code: 'INVOKE_EXCEPTION',
                message: getInvokeErrorMessage(err),
                details: err,
            },
        };
    }
}

function getInvokeErrorCode(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
        const code = (error as Record<string, unknown>)['code'];
        if (typeof code === 'string') {
            return code;
        }
    }

    return 'UNKNOWN';
}

function getInvokeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === 'string') {
        return error;
    }

    if (typeof error === 'object' && error !== null) {
        const obj = error as Record<string, unknown>;
        if (typeof obj['message'] === 'string') {
            return obj['message'];
        }
        if ('payload' in obj) {
            return stringifyInvokeError(obj['payload']);
        }
    }

    return stringifyInvokeError(error);
}

function stringifyInvokeError(error: unknown): string {
    if (typeof error === 'string') {
        return error;
    }

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

/**
 * Helper to use with tauri-specta generated commands if needed,
 * or as a pattern for our own service methods.
 */
