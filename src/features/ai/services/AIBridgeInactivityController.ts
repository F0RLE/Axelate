import type { LoggerService } from '@/infrastructure/logging/LoggerService';

type AIBridgeInactivityLogger = Pick<LoggerService, 'info'>;

export class AIBridgeInactivityController {
    private _timer: ReturnType<typeof setTimeout> | null = null;
    private _paused = false;

    constructor(
        private readonly _timeoutMs: number,
        private readonly _tracer: AIBridgeInactivityLogger,
        private readonly _onTimeout: () => void,
    ) {}

    public clear(): void {
        if (this._timer !== null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }

    public pause(): void {
        this._paused = true;
        this.clear();
    }

    public resume(): void {
        this._paused = false;
        this.reset();
    }

    public reset(): void {
        this.clear();
        if (this._paused) {
            return;
        }

        this._timer = setTimeout(() => {
            this._tracer.info(
                '[AIBridge] Engine inactivity timeout reached. Stopping provider to save memory.',
            );
            this._onTimeout();
        }, this._timeoutMs);
    }
}
