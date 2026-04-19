type ConsolePollingRuntime = Pick<typeof globalThis, 'setInterval' | 'clearInterval'>;

type ConsolePollingControllerDeps = {
    runtime?: ConsolePollingRuntime;
    isConsolePageActive: () => boolean;
    poll: () => void;
};

export class ConsolePollingController {
    private _intervalId: number | null = null;

    public constructor(private readonly _deps: ConsolePollingControllerDeps) {}

    public start(intervalMs: number): void {
        this.stop();

        const runtime = this._deps.runtime ?? globalThis;
        this._intervalId = runtime.setInterval(() => {
            if (!this._deps.isConsolePageActive()) {
                return;
            }

            this._deps.poll();
        }, intervalMs) as unknown as number;
    }

    public stop(): void {
        if (this._intervalId === null) {
            return;
        }

        const runtime = this._deps.runtime ?? globalThis;
        runtime.clearInterval(this._intervalId);
        this._intervalId = null;
    }
}
