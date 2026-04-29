import type { ConsoleLogService } from '../services/ConsoleLogService';

type ConsoleRefreshCoordinatorDeps = {
    service: Pick<ConsoleLogService, 'fetchLogs'>;
    getActiveViewId: () => string;
    refreshLogViews: () => Promise<boolean>;
    renderLogs: (clear?: boolean) => void;
};

export class ConsoleRefreshCoordinator {
    public constructor(private readonly _deps: ConsoleRefreshCoordinatorDeps) {}

    public async refreshOnOpen(): Promise<void> {
        await this._deps.refreshLogViews();
        await this._deps.service.fetchLogs(this._deps.getActiveViewId());
        this._deps.renderLogs(true);
    }

    public async refreshFromPolling(): Promise<void> {
        const viewsChanged = await this._deps.refreshLogViews();
        const newLogs = await this._deps.service.fetchLogs(this._deps.getActiveViewId());

        if (viewsChanged || newLogs.length > 0) {
            this._deps.renderLogs();
        }
    }
}
