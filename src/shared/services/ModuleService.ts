/**
 * @module core/services/ModuleService
 * @description Service for managing module downloads, installations, and status updates
 */

import { type IBridge } from '@/shared/types/IBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IModuleDownloadState } from '../types/coreTypes';
import { commands } from '../types/bindings';
import { invokeSafe } from '../api/invoke';

// Local types for global access
// IModuleGlobal removed

type ModuleServiceLogger = Pick<LoggerService, 'info' | 'warn' | 'error'>;

export class ModuleService {
    private readonly _downloadState: Record<string, IModuleDownloadState> = {};
    private readonly _deletedModules = new Set<string>();
    private readonly _lastLoggedDownloadPhase = new Map<string, string>();
    private _downloadProgressUnlisten: (() => void) | null = null;
    private _initialized = false;

    constructor(
        private readonly _bridge: IBridge,
        private readonly _tracer: ModuleServiceLogger,
    ) {}

    /**
     * Initializes the module service and binds to download progress events from the backend.
     */
    public async init() {
        if (this._initialized) return;
        this._initialized = true;
        if (!this._bridge.isTauri()) return;

        this._downloadProgressUnlisten = await this._bridge.listen<{
            module_id: string;
            status: string;
            progress: number;
            message: string;
            downloaded: number;
            total: number;
            speed: number;
        }>('download_progress', (payload) => {
            this._logDownloadPhase(payload);

            this._downloadState[payload.module_id] = {
                status: payload.status as
                    | 'init'
                    | 'pending'
                    | 'connecting'
                    | 'downloading'
                    | 'extracting'
                    | 'complete'
                    | 'error'
                    | 'cancelled',
                progress: payload.progress,
                message: payload.message,
                downloaded: payload.downloaded,
                total: payload.total,
                speed: payload.speed,
            };

            if (payload.status === 'complete') {
                (this._downloadState[payload.module_id] as { progress: number }).progress = 1;
            }

            // Dispatch custom event for UI components that don't use this service directly
            const event = new CustomEvent('download-progress-update', { detail: payload });
            globalThis.dispatchEvent(event);
        });
    }

    /**
     * Cleans up active backend listeners.
     */
    public destroy(): void {
        this._downloadProgressUnlisten?.();
        this._downloadProgressUnlisten = null;
        this._lastLoggedDownloadPhase.clear();
        this._initialized = false;
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
            this._tracer.warn(`[ModuleService] Check installed failed: ${result.error.message}`);
            return false;
        } catch (err) {
            this._tracer.error(`Check installed error: ${String(err)}`);
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
        dlType?: string,
    ): Promise<void> {
        this._tracer.info(`[ModuleService] Downloading module: ${moduleId} from ${repoUrl}`);
        if (expectedHash !== undefined && expectedHash !== '') {
            this._tracer.info(`[ModuleService] Expected hash: ${expectedHash}`);
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
            const result = await invokeSafe(
                commands.downloadModule(moduleId, repoUrl, hashToPass, dlType ?? null),
            );

            if (result.status === 'error') {
                throw new Error(result.error.message);
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this._tracer.error(`[ModuleService] Download error for ${moduleId}: ${errorMessage}`);
            this._downloadState[moduleId] = { status: 'error', progress: 0, error: errorMessage };
            throw err;
        }
    }

    /**
     * Cancels an in-progress module download.
     * @param moduleId - The ID of the module whose download to cancel
     */
    public async cancelDownload(moduleId: string): Promise<boolean> {
        this._tracer.info(`[ModuleService] Cancelling download: ${moduleId}`);
        if (!this._bridge.isTauri()) return false;
        try {
            return await commands.cancelDownload(moduleId);
        } catch (e) {
            this._tracer.error(`[ModuleService] Cancel failed: ${String(e)}`);
            return false;
        }
    }

    /**
     * Deletes a module from the local disk
     * @param moduleId - The ID of the module to delete
     */
    public async deleteModule(moduleId: string): Promise<boolean> {
        this._tracer.info(`[ModuleService] Deleting module: ${moduleId}`);
        if (!this._bridge.isTauri()) {
            throw new Error('Delete available only in desktop app');
        }

        try {
            // Updated to use new API layer
            const result = await invokeSafe(commands.deleteModule(moduleId));

            if (result.status === 'error') {
                this._tracer.error(`[ModuleService] Delete failed: ${result.error.message}`);
                return false;
            }

            this._deletedModules.add(moduleId);
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete this._downloadState[moduleId];
            return true;
        } catch (e) {
            this._tracer.error(`[ModuleService] Delete exception: ${String(e)}`);
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
        this._tracer.info(`[ModuleService] Control ${serviceName} -> ${action}`);
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
                this._tracer.error(`[ModuleService] Control failed: ${String(e)}`);
                return false;
            }
        } else {
            this._tracer.warn('[ModuleService] Control not available in web mode');
            return false;
        }
    }

    /**
     * Gets the current download state for a specific module.
     */
    public getDownloadState(moduleId: string): IModuleDownloadState | undefined {
        return this._downloadState[moduleId];
    }

    private _logDownloadPhase(payload: {
        module_id: string;
        status: string;
        progress: number;
        message: string;
        downloaded: number;
        total: number;
        speed: number;
    }): void {
        const phaseKey = `${payload.status}:${payload.message}`;
        const previous = this._lastLoggedDownloadPhase.get(payload.module_id);
        if (previous === phaseKey) return;

        this._lastLoggedDownloadPhase.set(payload.module_id, phaseKey);

        const progressPercent =
            payload.progress >= 0 ? ` ${(payload.progress * 100).toFixed(1)}%` : '';
        this._tracer.info(
            `[ModuleService] ${payload.module_id} -> ${payload.status}${progressPercent} ${payload.message}`.trim(),
        );

        if (
            payload.status === 'complete' ||
            payload.status === 'error' ||
            payload.status === 'cancelled'
        ) {
            this._lastLoggedDownloadPhase.delete(payload.module_id);
        }
    }
}
