/**
 * @module shared/types/IBridge
 * @description Generic bridge interface for IPC communication
 */

export interface IBridge {
    /**
     * Invoke a command on the host.
     */
    invoke<T, A extends Record<string, unknown> = Record<string, unknown>>(
        cmd: string,
        args?: A,
    ): Promise<T>;

    /**
     * Listen for events from the host.
     */
    listen<T>(event: string, callback: (payload: T) => void): Promise<() => void>;

    /**
     * Check if running in the host environment (e.g. Tauri).
     */
    isTauri(): boolean;
}
