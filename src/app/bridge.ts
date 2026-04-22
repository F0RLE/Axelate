/**
 * @module core/boot/GlobalBridge
 * @description Provides runtime transport adapters used during boot.
 */

import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { ModuleService } from '@/shared/services/ModuleService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { IApp } from '@/shared/types/coreTypes';

export interface ICoreBridge {
    readonly aiBridge: AIBridge;
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

    public async launchApp(category: string, app: IApp): Promise<void> {
        this._core.tracer.debug(`[GlobalBridge] Launching ${category}: ${app.id}`);

        if (category.startsWith('ai')) {
            await this._core.aiBridge.startProvider(app.id);
            return;
        }

        if (app.managedExternally === true || this._core.tauriProvider.isTauri() !== true) {
            return;
        }

        try {
            const started = await this._core.moduleService.control(app.id, 'start');
            if (!started) {
                this._core.tracer.warn?.(
                    `[GlobalBridge] Failed to start local module: ${app.id}`,
                );
            }
        } catch (err) {
            this._core.tracer.error('[GlobalBridge] Launch module failed:', err);
        }
    }
}
