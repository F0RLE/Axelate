/**
 * @module core/services/ModuleService
 * @description Service for managing module downloads, installations, and status updates
 */

import { type TauriProvider } from './TauriProvider';
import type { IModuleDownloadState } from '../types/coreTypes';
import type { TGlobalWin } from '../types/global_bridge_types';

// Local types for global access
// IModuleGlobal removed

export class ModuleService {
    private readonly _downloadState: Record<string, IModuleDownloadState> = {};
    private readonly _deletedModules = new Set<string>();

    constructor(private readonly _tauri: TauriProvider) {}

    /**
     * Initializes the module service and binds to download progress events from the backend.
     */
    public async init() {
        if (!this._tauri.isTauri()) return;

        await this._tauri.listen<{
            module_id: string;
            status: string;
            progress: number;
            message: string;
            downloaded: number;
            total: number;
        }>('download_progress', (payload) => {
            console.log('[ModuleService] Progress Event:', payload);

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
                const state = this._downloadState[payload.module_id];
                if (state) state.progress = 1;
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
        if (!this._tauri.isTauri()) return false;
        if (this._deletedModules.has(moduleId)) return false;

        try {
            return await this._tauri.invoke<boolean>('check_module_installed', {
                moduleId: moduleId,
            });
        } catch (err) {
            console.error('Check installed error:', err);
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
        console.log(`[ModuleService] Downloading module: ${moduleId} from ${repoUrl}`);
        if (expectedHash) console.log(`[ModuleService] Expected hash: ${expectedHash}`);

        if (!this._tauri.isTauri()) {
            throw new Error('Download available only in desktop app');
        }

        try {
            this._deletedModules.delete(moduleId);
            // Sanitize expectedHash: pass null if empty string or undefined to ensure rust gets None
            const hashToPass = expectedHash && expectedHash.trim() !== '' ? expectedHash : null;

            await this._tauri.invoke('download_module', {
                moduleId: moduleId,
                repoUrl: repoUrl,
                expectedHash: hashToPass,
            });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(`[ModuleService] Download error for ${moduleId}:`, errorMessage);
            this._downloadState[moduleId] = { status: 'error', progress: 0, error: errorMessage };
            this._broadcastState(moduleId);
            throw err;
        }
    }

    /**
     * Deletes a module from the local disk
     * @param moduleId - The ID of the module to delete
     */
    public async deleteModule(moduleId: string): Promise<boolean> {
        console.log(`[ModuleService] Deleting module: ${moduleId}`);
        if (!this._tauri.isTauri()) {
            throw new Error('Delete available only in desktop app');
        }

        try {
            await this._tauri.invoke('delete_module', { moduleId: moduleId });

            this._deletedModules.add(moduleId);
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete this._downloadState[moduleId];
            return true;
        } catch (e) {
            console.error('[ModuleService] Delete failed:', e);
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
        console.log(`[ModuleService] Control ${serviceName} -> ${action}`);
        if (this._tauri.isTauri()) {
            try {
                await this._tauri.invoke('control_module', {
                    request: {
                        module_id: serviceName,
                        action: action.toLowerCase(),
                    },
                });
                return true;
            } catch (e) {
                console.error('[ModuleService] Control failed:', e);
                return false;
            }
        } else {
            console.warn('[ModuleService] Control not available in web mode');
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
        const win = globalThis as TGlobalWin;
        if (!win.moduleDownloadState) win.moduleDownloadState = {};
        const state = this._downloadState[moduleId];
        if (state) {
            win.moduleDownloadState[moduleId] = state;
        }
    }
}
