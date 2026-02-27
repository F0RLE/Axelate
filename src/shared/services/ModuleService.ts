/**
 * @module core/services/ModuleService
 * @description Service for managing module downloads, installations, and status updates
 */

import { type IBridge } from '@/shared/types/IBridge';
import { tracer } from '@/infrastructure/logging/LoggerService';
import type { IModuleDownloadState } from '../types/coreTypes';
import { getGlobalWin } from '@/shared/utils/globalAccessor';
import { commands } from '../types/bindings';
import { invokeSafe } from '../api/invoke';

// Local types for global access
// IModuleGlobal removed

export class ModuleService {
    private readonly _downloadState: Record<string, IModuleDownloadState> = {};
    private readonly _deletedModules = new Set<string>();

    constructor(private readonly _bridge: IBridge) {}

    /**
     * Initializes the module service and binds to download progress events from the backend.
     */
    public async init() {
        if (!this._bridge.isTauri()) return;

        await this._bridge.listen<{
            module_id: string;
            status: string;
            progress: number;
            message: string;
            downloaded: number;
            total: number;
        }>('download_progress', (payload) => {
            tracer.debug(`[ModuleService] Progress Event: ${JSON.stringify(payload)}`);

            this._downloadState[payload.module_id] = {
                status: payload.status as
                    | 'init'
                    | 'pending'
                    | 'connecting'
                    | 'downloading'
                    | 'extracting'
                    | 'complete'
                    | 'error',
                progress: payload.progress,
                message: payload.message,
                downloaded: payload.downloaded,
                total: payload.total,
            };

            if (payload.status === 'complete') {
                (this._downloadState[payload.module_id] as { progress: number }).progress = 1;
            }

            this._broadcastState(payload.module_id);

            // Dispatch custom event for UI components that don't use this service directly
            const event = new CustomEvent('download-progress-update', { detail: payload });
            globalThis.dispatchEvent(event);
        });
    }

    /**
     * Checks if a module is currently installed on the system.
     */
    public async checkInstalled(moduleId: string): Promise<boolean> {
        if (!this._bridge.isTauri()) return false;
        if (this._deletedModules.has(moduleId)) return false;

        try {
            // Updated to use new API layer
            const result = await invokeSafe(commands.checkModuleInstalled(moduleId));
            if (result.status === 'ok') {
                return result.data;
            }
            tracer.warn(`[ModuleService] Check installed failed: ${result.error.message}`);
            return false;
        } catch (err) {
            tracer.error(`Check installed error: ${String(err)}`);
            return false;
        }
    }

    /**
     * Downloads a module from a repository URL
     * @param moduleId - The ID of the module to download
     * @param repoUrl - The URL of the repository (or archive)
     * @param expectedHash - Optional SHA256 hash to verify
     */
    public async downloadModule(
        moduleId: string,
        repoUrl: string,
        expectedHash?: string,
    ): Promise<void> {
        tracer.info(`[ModuleService] Downloading module: ${moduleId} from ${repoUrl}`);
        if (expectedHash !== undefined && expectedHash !== '') {
            tracer.info(`[ModuleService] Expected hash: ${expectedHash}`);
        }

        if (!this._bridge.isTauri()) {
            throw new Error('Download available only in desktop app');
        }

        try {
            this._deletedModules.delete(moduleId);
            // Sanitize expectedHash: pass null if empty string or undefined to ensure rust gets None
            const hashToPass =
                expectedHash !== undefined && expectedHash.trim() !== '' ? expectedHash : null;

            // Updated to use new API layer
            const result = await invokeSafe(commands.downloadModule(moduleId, repoUrl, hashToPass));

            if (result.status === 'error') {
                throw new Error(result.error.message);
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            tracer.error(`[ModuleService] Download error for ${moduleId}: ${errorMessage}`);
            this._downloadState[moduleId] = { status: 'error', progress: 0, error: errorMessage };
            this._broadcastState(moduleId);
            throw err;
        }
    }

    /**
     * Cancels an in-progress module download.
     * @param moduleId - The ID of the module whose download to cancel
     */
    public async cancelDownload(moduleId: string): Promise<boolean> {
        tracer.info(`[ModuleService] Cancelling download: ${moduleId}`);
        if (!this._bridge.isTauri()) return false;
        try {
            return await commands.cancelDownload(moduleId);
        } catch (e) {
            tracer.error(`[ModuleService] Cancel failed: ${String(e)}`);
            return false;
        }
    }

    /**
     * Deletes a module from the local disk
     * @param moduleId - The ID of the module to delete
     */
    public async deleteModule(moduleId: string): Promise<boolean> {
        tracer.info(`[ModuleService] Deleting module: ${moduleId}`);
        if (!this._bridge.isTauri()) {
            throw new Error('Delete available only in desktop app');
        }

        try {
            // Updated to use new API layer
            const result = await invokeSafe(commands.deleteModule(moduleId));

            if (result.status === 'error') {
                tracer.error(`[ModuleService] Delete failed: ${result.error.message}`);
                return false;
            }

            this._deletedModules.add(moduleId);
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete this._downloadState[moduleId];
            return true;
        } catch (e) {
            tracer.error(`[ModuleService] Delete exception: ${String(e)}`);
            return false;
        }
    }

    /**
     * Controls a module service (start, stop, restart).
     *
     * @param serviceName - The name of the service/module
     * @param action - The action to perform (start, stop, restart)
     */
    public async control(serviceName: string, action: string): Promise<boolean> {
        tracer.info(`[ModuleService] Control ${serviceName} -> ${action}`);
        if (this._bridge.isTauri()) {
            try {
                await this._bridge.invoke('control_module', {
                    request: {
                        module_id: serviceName,
                        action: action.toLowerCase(),
                    },
                });
                return true;
            } catch (e) {
                tracer.error(`[ModuleService] Control failed: ${String(e)}`);
                return false;
            }
        } else {
            tracer.warn('[ModuleService] Control not available in web mode');
            return false;
        }
    }

    /**
     * Gets the current download state for a specific module.
     */
    public getDownloadState(moduleId: string): IModuleDownloadState | undefined {
        return this._downloadState[moduleId];
    }

    // Sync state to legacy window object for UI compatibility
    /**
     * Broadcasts download state to global scope for legacy UI compatibility.
     */
    private _broadcastState(moduleId: string) {
        const win = getGlobalWin();
        win.moduleDownloadState ??= {};
        const state = this._downloadState[moduleId];
        /* v8 ignore next */
        if (state !== undefined) {
            win.moduleDownloadState[moduleId] = state;
        }
    }
}
