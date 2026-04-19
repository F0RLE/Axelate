import type { IBridge } from '@/shared/types/IBridge';

import type { IWindowPolicy } from './WindowService';
import type { WindowServiceZoom } from './WindowServiceZoom';

type WindowPolicyLogger = {
    info: (message: string) => void;
    error: (message: string) => void;
};

type WindowPolicyRuntime = {
    getScreenSize: () => { width: number; height: number };
};

type WindowServicePolicyDeps = {
    bridge: IBridge;
    runtime: WindowPolicyRuntime;
    tracer: WindowPolicyLogger;
    getCurrentZoom: () => number;
    setZoom: (zoom: number) => Promise<number>;
    zoomService: WindowServiceZoom;
};

export class WindowServicePolicy {
    private _lastResolutionKey = '';

    constructor(private readonly _deps: WindowServicePolicyDeps) {}

    public async checkPolicy(): Promise<IWindowPolicy> {
        this.syncResolutionChange();

        if (!this._deps.bridge.isTauri()) {
            return { isSmallScreen: false, showWarning: false };
        }

        try {
            return await this._deps.bridge.invoke<IWindowPolicy>('get_window_policy');
        } catch (error) {
            this._deps.tracer.error(
                `[WindowService] Failed to fetch window policy: ${String(error)}`,
            );
            return { isSmallScreen: false, showWarning: false };
        }
    }

    public checkResolutionChange(): void {
        this.syncResolutionChange();
    }

    private syncResolutionChange(): void {
        const currentResolutionKey = this.getCurrentResolutionKey();
        if (
            currentResolutionKey === this._lastResolutionKey ||
            currentResolutionKey === 'unknown'
        ) {
            return;
        }

        const previousResolutionKey = this._lastResolutionKey;
        this._lastResolutionKey = currentResolutionKey;
        this._deps.tracer.info(
            `[WindowService] Resolution changed: ${previousResolutionKey} -> ${currentResolutionKey}`,
        );
        void this.handleResolutionChange();
    }

    private getCurrentResolutionKey(): string {
        const screen = this._deps.runtime.getScreenSize();
        return `${screen.width.toString()}x${screen.height.toString()}`;
    }

    private async handleResolutionChange(): Promise<void> {
        const zoom = await this._deps.zoomService.handleResolutionChange(
            this._deps.getCurrentZoom(),
        );
        if (zoom !== null) {
            await this._deps.setZoom(zoom);
        }
    }
}
