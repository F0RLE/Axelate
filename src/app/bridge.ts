/**
 * @module core/boot/GlobalBridge
 * @description Provides runtime transport adapters used during boot.
 */

import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { CatalogService } from '@/shared/services/CatalogService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { ModuleService } from '@/shared/services/ModuleService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { AIBridge } from '@/features/ai/services/AIBridge';

export interface ICoreBridge {
    readonly aiSettings: AISettingsService;
    readonly aiBridge: AIBridge;
    readonly catalog: CatalogService;
    readonly tracer: LoggerService;
    readonly moduleService: ModuleService;
    readonly tauriProvider: TauriProvider;
}

type GlobalBridgeRuntime = {};

/**
 * GlobalBridge keeps runtime transport concerns out of Core boot logic.
 */
export class GlobalBridge {
    private readonly _core: ICoreBridge;

    constructor(core: ICoreBridge, _runtime?: GlobalBridgeRuntime) {
        this._core = core;
    }

    /**
     * Initialize runtime interceptors.
     */
    public init(): void {
        /* no-op: legacy fetch interceptor removed */
    }

    public destroy(): void {
        /* no-op */
    }

    public async launchApp(id: string): Promise<void> {
        this._core.tracer.debug(`[GlobalBridge] Launching App: ${id}`);

        const catalog = this._core.catalog.getCatalog();
        const isAiApp = catalog.ai.some((a) => a.id === id);

        if (isAiApp) {
            await this._core.aiBridge.startProvider(id);
        }

        if (this._core.tauriProvider.isTauri()) {
            try {
                const result = await this._core.tauriProvider.invoke<{
                    action: string;
                    provider?: string;
                }>('launch_module', { moduleId: id });

                if (
                    result.action === 'navigate' &&
                    result.provider !== undefined &&
                    result.provider !== ''
                ) {
                    this._core.aiSettings.setLastActiveProvider(result.provider);
                } else if (result.action === 'start_local') {
                    await this._core.moduleService.control(id, 'start');
                }
            } catch (err) {
                this._core.tracer.error('[GlobalBridge] Launch module failed:', err);
            }
            return;
        }

        const apiModules = ['gpt', 'gemini', 'claude', 'mistral'];
        if (apiModules.includes(id)) {
            this._core.aiSettings.setLastActiveProvider(id);
        }
    }
}
