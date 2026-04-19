import type { IModuleDownloadState as ModuleDownloadState } from '@/shared/types/coreTypes';

export class DownloadUiStateController {
    private readonly _activeDownloads = new Map<string, ModuleDownloadState>();

    public reset(): void {
        this._activeDownloads.clear();
    }

    public set(moduleId: string, state: ModuleDownloadState): void {
        this._activeDownloads.set(moduleId, state);
    }

    public delete(moduleId: string): void {
        this._activeDownloads.delete(moduleId);
    }

    public getAll(): Map<string, ModuleDownloadState> {
        return this._activeDownloads;
    }

    public getPrimaryEntry(): [string, ModuleDownloadState] | undefined {
        const activeStatuses = new Set(['connecting', 'downloading', 'extracting']);

        for (const entry of this._activeDownloads.entries()) {
            if (activeStatuses.has(entry[1].status)) {
                return entry;
            }
        }

        const firstEntry = this._activeDownloads.entries().next();
        return firstEntry.done === true ? undefined : firstEntry.value;
    }
}
