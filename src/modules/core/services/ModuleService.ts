/**
 * @module core/services/ModuleService
 * @description Service for managing module downloads, installations, and status updates
 */

import { TauriProvider } from './TauriProvider';
import { IModuleDownloadState } from '../types/coreTypes';

// Local types for global access
interface IModuleGlobal {
    moduleDownloadState: Record<string, IModuleDownloadState>;
    dispatchEvent: (event: Event) => boolean;
}

export class ModuleService {
    private readonly _downloadState: Record<string, IModuleDownloadState> = {};
    private readonly _deletedModules: Set<string> = new Set();

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
                status: payload.status as 'init' | 'pending' | 'connecting' | 'downloading' | 'extracting' | 'complete' | 'error',
                progress: payload.progress,
                message: payload.message,
                downloaded: payload.downloaded,
                total: payload.total,
            };

            if (payload.status === 'complete') {
                this._downloadState[payload.module_id].progress = 1;
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
            return await this._tauri.invoke<boolean>('check_module_installed', { moduleId });

        } catch (e) {
            console.error('Check installed failed:', e);
            return false;
        }
    }

    /**
     * Triggers the download and installation of a module.
     */
    public async downloadModule(moduleId: string, repoUrl: string): Promise<void> {
        if (!this._tauri.isTauri()) {
            throw new Error('Download available only in desktop app');
        }

        try {
            this._deletedModules.delete(moduleId);
            // We only trigger the command. Progress is handled by initEventListeners()
            await this._tauri.invoke('download_module', { moduleId, repo_url: repoUrl });
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            this._downloadState[moduleId] = { status: 'error', progress: 0, error: errorMessage };
            this._broadcastState(moduleId);
            throw e;
        }
    }

    /**
     * Permanently deletes a module and its associated files.
     */
    public async deleteModule(moduleId: string): Promise<boolean> {
        if (!this._tauri.isTauri()) {
             throw new Error('Delete available only in desktop app');
        }

        try {
             await this._tauri.invoke('delete_module', { moduleId });

             this._deletedModules.add(moduleId);
             delete this._downloadState[moduleId];
             return true;
        } catch (e) {
             console.error('Delete failed:', e);
             return false;
        }
    }

    /**
     * Controls a module service (start, stop, restart).
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
                console.error('Control failed:', e);
                return false;
            }
        } else {
            // Mock or API fallback
            if (import.meta.env.DEV) {
                try {
                    const res = await fetch('http://localhost:3000/api/control', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ service: serviceName, action: action.toLowerCase() }),
                    });
                    return res.ok;
                } catch (e) {
                    console.error('API Control failed:', e);
                    return false;
                }
            }
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
        const win = globalThis as unknown as IModuleGlobal;
        if (!win.moduleDownloadState) win.moduleDownloadState = {};
        win.moduleDownloadState[moduleId] = this._downloadState[moduleId];
    }
}
