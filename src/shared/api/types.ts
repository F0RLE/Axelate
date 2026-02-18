export type AppError = {
    code: string;
    message: string;
    details?: unknown;
};

export type Result<T, E = AppError> = { status: 'ok'; data: T } | { status: 'error'; error: E };

export function isOk<T, E>(result: Result<T, E>): result is { status: 'ok'; data: T } {
    return result.status === 'ok';
}

export function isError<T, E>(result: Result<T, E>): result is { status: 'error'; error: E } {
    return result.status === 'error';
}
