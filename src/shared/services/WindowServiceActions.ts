import type { IBridge } from '@/shared/types/IBridge';

type WindowActionsLogger = {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
};

type WindowActionsRuntime = {
    close: () => void;
};

type WindowServiceActionsDeps = {
    bridge: IBridge;
    runtime: WindowActionsRuntime;
    tracer: WindowActionsLogger;
    beforeClose: () => (() => Promise<void>) | null;
};

export class WindowServiceActions {
    constructor(private readonly _deps: WindowServiceActionsDeps) {}

    public async minimize(): Promise<void> {
        if (this._deps.bridge.isTauri()) {
            await this._deps.bridge.invoke('minimize_window');
        } else {
            this._deps.tracer.info('[WindowService] minimize (mock)');
        }
    }

    public async toggleMaximize(): Promise<void> {
        if (this._deps.bridge.isTauri()) {
            await this._deps.bridge.invoke('maximize_window');
        } else {
            this._deps.tracer.info('[WindowService] toggleMaximize (mock)');
        }
    }

    public async close(): Promise<void> {
        if (this._deps.bridge.isTauri()) {
            const beforeClose = this._deps.beforeClose();
            await beforeClose?.();
            await this._deps.bridge.invoke('close_window');
        } else {
            this._deps.runtime.close();
        }
    }

    public async hideToTray(minimizeFallback: () => Promise<void>): Promise<void> {
        if (this._deps.bridge.isTauri()) {
            try {
                await this._deps.bridge.invoke('hide_window');
            } catch {
                await minimizeFallback();
            }
        } else {
            this._deps.tracer.info('[WindowService] hideToTray (mock)');
        }
    }

    public async show(): Promise<void> {
        if (!this._deps.bridge.isTauri()) {
            this._deps.tracer.info('[WindowService] Not in Tauri, skipping native show');
            return;
        }

        const maxRetries = 3;
        for (let index = 0; index < maxRetries; index += 1) {
            try {
                await this._deps.bridge.invoke('show_window');
                return;
            } catch (error) {
                this._deps.tracer.warn(
                    `[WindowService] show_window attempt ${(index + 1).toString()} failed: ${String(error)}`,
                );
                if (index < maxRetries - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 300));
                }
            }
        }

        this._deps.tracer.error(
            '[WindowService] All show_window attempts failed. Continuing anyway.',
        );
    }

    public async setMonitoringPaused(paused: boolean): Promise<void> {
        if (!this._deps.bridge.isTauri()) {
            return;
        }

        try {
            await this._deps.bridge.invoke('set_monitoring_paused', { paused });
        } catch {
            this._deps.tracer.error('[WindowService] Failed to set monitoring state');
        }
    }
}
