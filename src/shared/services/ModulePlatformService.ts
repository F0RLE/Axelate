import type { IApp } from '../types/coreTypes';
import type { ModuleService } from './ModuleService';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { isApiApp } from '@/shared/utils/moduleTypeUtils';

type ModulePlatformLogger = Pick<LoggerService, 'info'>;

/**
 * @class ModulePlatformService
 * @description Facade for platform-specific module operations (Download/Delete/Stop).
 * Abstracts differences between Local modules (ModuleService/Tauri) and API modules (AIBridge).
 */
export class ModulePlatformService {
    constructor(
        private readonly requestModuleService: () => ModuleService,
        private readonly _aiBridge: AIBridge,
        private readonly _tracer: ModulePlatformLogger,
    ) {}

    private get _moduleService(): ModuleService {
        return this.requestModuleService();
    }

    /**
     * Downloads a module.
     * @param app The module to download.
     */
    public async download(app: IApp): Promise<void> {
        this._tracer.info(`[ModulePlatformService] Downloading: ${app.id}`);

        if (app.repoUrl === undefined || app.repoUrl === '') {
            throw new Error('ui.launcher.web.download_url_empty'); // Key for localization
        }

        const url: string = app.repoUrl;
        await this._moduleService.downloadModule(app.id, url, app.expectedHash, app.dlType);
    }

    /**
     * Deletes a module.
     * @param app The module to delete.
     */
    public async delete(app: IApp): Promise<void> {
        this._tracer.info(`[ModulePlatformService] Deleting: ${app.id}`);
        const success = await this._moduleService.deleteModule(app.id);
        if (!success) {
            throw new Error('ui.launcher.web.delete_model_error');
        }
    }

    /**
     * Stops a running module or provider.
     * @param app The module to stop.
     */
    public async stop(app: IApp): Promise<boolean> {
        const isApi = this._isApiModule(app);

        if (isApi) {
            // Stop API Provider
            const activeProviderId = this._aiBridge.getState().activeProviderId;
            if (activeProviderId !== app.id) {
                this._tracer.info(
                    `[ModulePlatformService] Skip stop for inactive API module: ${app.id} (active: ${activeProviderId ?? 'none'})`,
                );
                return false;
            }
            this._aiBridge.stopProvider();
            return true;
        } else {
            if (app.managedExternally === true) {
                this._tracer.info(
                    `[ModulePlatformService] Skip local stop for externally managed module: ${app.id}`,
                );
                return true;
            }

            // Stop Local Process
            // Currently ModuleService.control handles this, or backend kills process?
            // Existing AppUI logic just showed a toast for local modules saying "Stopped"
            // but didn't actually call a stop command for local/binary modules explicitly here?
            // Wait, previous code:
            // if (isApi) { win.aiBridge.stopProvider(); }
            // else { win.showToast(... "stopped"); logger.info(...); }
            // So for local modules, it seems it was just a UI state update or the backend handles it via other means?
            // Actually ModuleService has `control(name, 'stop')`.

            // Let's try to actually stop it if possible, or just log it as before.
            // If it's a "service" module (managed by backend), we should call control or stop.
            // But AppUI's `_stopPreviousModule` seemed to only effectively stop AIProviders.
            // For now, we replicate existing behavior but clearer.

            this._tracer.info(
                `[ModulePlatformService] Requesting stop for local module: ${app.id}`,
            );
            // If we have a control method, use it:
            return await this._moduleService.control(app.id, 'stop');
        }
    }

    /**
     * Cancels an in-progress download for a module.
     * @param moduleId The ID of the module to cancel downloading.
     */
    public async cancelDownload(moduleId: string): Promise<boolean> {
        this._tracer.info(`[ModulePlatformService] Cancelling download: ${moduleId}`);
        return await this._moduleService.cancelDownload(moduleId);
    }

    /**
     * Pauses an in-progress download for a module.
     * @param moduleId The ID of the module to pause downloading.
     */
    public async pauseDownload(moduleId: string): Promise<boolean> {
        this._tracer.info(`[ModulePlatformService] Pausing download: ${moduleId}`);
        return await this._moduleService.pauseDownload(moduleId);
    }

    /**
     * Resumes a paused download for a module.
     * @param moduleId The ID of the module to resume downloading.
     */
    public async resumeDownload(moduleId: string): Promise<boolean> {
        this._tracer.info(`[ModulePlatformService] Resuming download: ${moduleId}`);
        return await this._moduleService.resumeDownload(moduleId);
    }

    /**
     * Checks whether a local module is installed.
     */
    public async checkInstalled(moduleId: string): Promise<boolean> {
        return await this._moduleService.checkInstalled(moduleId);
    }

    /**
     * Checks if an app is an API-based module.
     */
    public isApiModule(app: IApp): boolean {
        return this._isApiModule(app);
    }

    private _isApiModule(app: IApp): boolean {
        return isApiApp(app);
    }
}
