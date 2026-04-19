type WindowUiTimeoutHandle = ReturnType<typeof setTimeout>;
type WindowUiTimeoutKey =
    | 'monitoring'
    | 'splash'
    | 'gracePeriod'
    | 'zoomCheck'
    | 'resize';

export class WindowUiTimingController {
    private readonly _timeouts: Record<WindowUiTimeoutKey, WindowUiTimeoutHandle | null> = {
        monitoring: null,
        splash: null,
        gracePeriod: null,
        zoomCheck: null,
        resize: null,
    };

    public setMonitoringTimeout(timeout: WindowUiTimeoutHandle | null): void {
        this._clearField('monitoring');
        this._timeouts['monitoring'] = timeout;
    }

    public scheduleGracePeriod(callback: () => void, delayMs: number): void {
        this._clearField('gracePeriod');
        this._timeouts['gracePeriod'] = setTimeout(() => {
            this._timeouts['gracePeriod'] = null;
            callback();
        }, delayMs);
    }

    public scheduleZoomCheck(callback: () => void, delayMs: number): void {
        this._clearField('zoomCheck');
        this._timeouts['zoomCheck'] = setTimeout(() => {
            this._timeouts['zoomCheck'] = null;
            callback();
        }, delayMs);
    }

    public scheduleResize(callback: () => void, delayMs: number): void {
        this._clearField('resize');
        this._timeouts['resize'] = setTimeout(() => {
            this._timeouts['resize'] = null;
            callback();
        }, delayMs);
    }

    public scheduleSplash(callback: () => void, delayMs: number): void {
        this._clearField('splash');
        this._timeouts['splash'] = setTimeout(() => {
            this._timeouts['splash'] = null;
            callback();
        }, delayMs);
    }

    public clearZoomCheck(): void {
        this._clearField('zoomCheck');
    }

    public clearSplash(): void {
        this._clearField('splash');
    }

    public clearAll(): void {
        this._clearField('monitoring');
        this._clearField('splash');
        this._clearField('gracePeriod');
        this._clearField('zoomCheck');
        this._clearField('resize');
    }

    private _clearField(field: WindowUiTimeoutKey): void {
        const timeout = this._timeouts[field];
        if (timeout !== null) {
            clearTimeout(timeout);
            this._timeouts[field] = null;
        }
    }
}
