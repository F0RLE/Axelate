import type { IApp, IModuleDownloadState } from '../types/coreTypes';
import type { DownloadModuleOutcome, ModuleService } from './ModuleService';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { invokeSafe } from '@/shared/api/invoke';
import { commands } from '@/shared/types/bindings';
import { isApiApp } from '@/shared/utils/moduleTypeUtils';
import { isAiCategory } from '@/shared/utils/moduleCategoryPolicy';

type ModulePlatformLogger = Pick<LoggerService, 'info'>;
export type ModuleRuntimeStatus = 'running' | 'stopped' | string;

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
    public async download(app: IApp): Promise<DownloadModuleOutcome> {
        this._tracer.info(`[ModulePlatformService] Downloading: ${app.id}`);

        if (app.repoUrl === undefined || app.repoUrl === '') {
            throw new Error('ui.launcher.web.download_url_empty'); // Key for localization
        }

        const url: string = app.repoUrl;
        return await this._moduleService.downloadModule(app.id, url, app.expectedHash, app.dlType);
    }

    /**
     * Deletes a module.
     * @param app The module to delete.
     */
    public async delete(app: IApp, category?: string): Promise<void> {
        this._tracer.info(`[ModulePlatformService] Deleting: ${app.id}`);
        if (category !== undefined && isAiCategory(category)) {
            await this._deleteAiEngine(app);
            return;
        }

        const success = await this._moduleService.deleteModule(app.id);
        if (!success) {
            throw new Error('ui.launcher.web.delete_model_error');
        }
    }

    /**
     * Stops a running module or provider.
     * @param app The module to stop.
     */
    public async stop(app: IApp, category?: string): Promise<boolean> {
        const isApi = this._isApiModule(app);
        const activeProviderId = this._aiBridge.getState().activeProviderId;

        if (activeProviderId === app.id) {
            this._aiBridge.stopProvider();
            return true;
        }

        if (isApi) {
            this._tracer.info(
                `[ModulePlatformService] Skip stop for inactive API module: ${app.id} (active: ${activeProviderId ?? 'none'})`,
            );
            return false;
        }

        if (app.managedExternally === true) {
            this._tracer.info(
                `[ModulePlatformService] Skip local stop for externally managed module: ${app.id}`,
            );
            return true;
        }

        if (category !== undefined && isAiCategory(category)) {
            await this._stopAiEngineSlot(category);
            return true;
        }

        this._tracer.info(`[ModulePlatformService] Requesting stop for local module: ${app.id}`);
        return await this._moduleService.control(app.id, 'stop');
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
     * Returns the real runtime status for an API provider or a local module.
     */
    public async getStatus(app: IApp): Promise<ModuleRuntimeStatus> {
        const state = this._aiBridge.getState();
        if (state.isRunning && state.activeProviderId === app.id) {
            return 'running';
        }

        if (this._isApiModule(app)) {
            return 'stopped';
        }

        if (app.managedExternally === true) {
            return app.status === 'running' ? 'running' : 'stopped';
        }

        return await this._moduleService.getStatus(app.id);
    }

    /**
     * Returns the latest backend download state mirrored by ModuleService.
     */
    public getDownloadState(moduleId: string): IModuleDownloadState | undefined {
        return this._moduleService.getDownloadState(moduleId);
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

    private async _stopAiEngineSlot(category: string): Promise<void> {
        const capability = category === 'ai_image' ? 'image' : 'text';
        this._tracer.info(`[ModulePlatformService] Force stopping AI engine slot: ${capability}`);
        await this._aiBridge.stopEngineSlot(capability);
    }

    private async _deleteAiEngine(app: IApp): Promise<void> {
        if (app.managedExternally === true) {
            this._tracer.info(
                `[ModulePlatformService] Skip delete for externally managed AI engine: ${app.id}`,
            );
            return;
        }

        const result = await invokeSafe(commands.deleteEngine(app.id));
        if (result.status === 'error') {
            throw new Error(result.error.message);
        }
    }
}
