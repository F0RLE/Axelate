import type { ConsoleLogService } from '../services/ConsoleLogService';

type ConsoleRefreshCoordinatorDeps = {
    service: Pick<ConsoleLogService, 'fetchLogs'>;
    refreshLogViews: () => Promise<boolean>;
    renderLogs: (clear?: boolean) => void;
};

export class ConsoleRefreshCoordinator {
    public constructor(private readonly _deps: ConsoleRefreshCoordinatorDeps) {}

    public async refreshOnOpen(): Promise<void> {
        await this._deps.service.fetchLogs();
        await this._deps.refreshLogViews();
        this._deps.renderLogs(true);
    }

    public async refreshFromPolling(): Promise<void> {
        const newLogs = await this._deps.service.fetchLogs();
        const viewsChanged = await this._deps.refreshLogViews();

        if (viewsChanged || newLogs.length > 0) {
            this._deps.renderLogs();
        }
    }
}
