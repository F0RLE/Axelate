import type { IWindowConfig } from '../services/WindowService';

type SidebarAutoCompactPolicyConfig = {
    collapsedWidth: number;
    expandedWidth: number;
    autoCompactZoomThreshold: number;
    autoCompactWarningLeadSteps: number;
    autoCompactZoomStep: number;
    autoCompactThresholdFactor: number;
};

type SidebarViewport = {
    width: number;
    height: number;
};

export class SidebarAutoCompactPolicy {
    constructor(private readonly _config: SidebarAutoCompactPolicyConfig) {}

    public isAutoCompact(
        zoom: number,
        windowConfig: IWindowConfig | null | undefined,
        viewport: SidebarViewport,
    ): boolean {
        if (windowConfig !== null && windowConfig !== undefined) {
            const leadZoom =
                zoom +
                this._config.autoCompactWarningLeadSteps * this._config.autoCompactZoomStep;
            const effectiveWidth = viewport.width / leadZoom;
            const effectiveHeight = viewport.height / leadZoom;
            const compactWarningWidth =
                windowConfig.thresholds.warningWidth * this._config.autoCompactThresholdFactor;
            const compactWarningHeight =
                windowConfig.thresholds.warningHeight * this._config.autoCompactThresholdFactor;

            return effectiveWidth < compactWarningWidth || effectiveHeight < compactWarningHeight;
        }

        return zoom >= this._config.autoCompactZoomThreshold;
    }

    public getSidebarWidth(collapsed: boolean, autoCompact: boolean): number {
        return collapsed || autoCompact
            ? this._config.collapsedWidth
            : this._config.expandedWidth;
    }

    public getPersistedWidth(collapsed: boolean): number {
        return collapsed ? this._config.collapsedWidth : this._config.expandedWidth;
    }
}
