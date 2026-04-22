type DownloadUiTimerRuntime = {
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
};

export class DownloadUiTerminalCleanupController {
    private readonly _timers = new Map<string, ReturnType<typeof setTimeout>>();

    public constructor(
        private readonly _runtime: DownloadUiTimerRuntime,
        private readonly _onCleanup: (moduleId: string) => void,
    ) {}

    public clearAll(): void {
        for (const moduleId of this._timers.keys()) {
            this.clear(moduleId);
        }
    }

    public clear(moduleId: string): void {
        const timer = this._timers.get(moduleId);
        if (timer === undefined) return;

        this._runtime.clearTimeout(timer);
        this._timers.delete(moduleId);
    }

    public schedule(moduleId: string, delayMs: number): void {
        this.clear(moduleId);
        const timer = this._runtime.setTimeout(() => {
            this._timers.delete(moduleId);
            this._onCleanup(moduleId);
        }, delayMs);
        this._timers.set(moduleId, timer);
    }
}
