export class ChatUiTimeoutManager {
    private readonly _timeouts = new Set<ReturnType<typeof setTimeout>>();

    public set(callback: () => void, delayMs: number): void {
        const timeout = globalThis.setTimeout(() => {
            this._timeouts.delete(timeout);
            callback();
        }, delayMs);
        this._timeouts.add(timeout);
    }

    public clearAll(): void {
        for (const timeout of this._timeouts) {
            clearTimeout(timeout);
        }
        this._timeouts.clear();
    }
}
