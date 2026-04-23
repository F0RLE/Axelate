import type { IModuleDownloadState as ModuleDownloadState } from '@/shared/types/coreTypes';

type DownloadUiEventControllerDeps = {
    clearTerminalCleanup: (moduleId: string) => void;
    scheduleTerminalCleanup: (moduleId: string, delayMs: number) => void;
    updateState: (moduleId: string, state: ModuleDownloadState) => void;
    renderState: () => void;
    renderProgressFromState: (moduleId: string, state: ModuleDownloadState) => void;
};

export class DownloadUiEventController {
    constructor(private readonly _deps: DownloadUiEventControllerDeps) {}

    public handleProgressEvent(event: Event): void {
        const payload = (event as CustomEvent).detail as ModuleDownloadState & {
            module_id?: string;
        };
        const moduleId = payload.module_id ?? '';
        if (moduleId === '') {
            return;
        }

        this._deps.clearTerminalCleanup(moduleId);

        if (
            payload.status === 'complete' ||
            payload.status === 'error' ||
            (payload.status as string) === 'cancelled'
        ) {
            this._deps.scheduleTerminalCleanup(moduleId, 2000);
        }

        this._deps.updateState(moduleId, payload);
        this._deps.renderState();
        this._deps.renderProgressFromState(moduleId, payload);
    }
}
