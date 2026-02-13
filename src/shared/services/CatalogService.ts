/**
 * @module core/services/CatalogService
 * @description Manages the application catalog and configuration
 */

import type { IBridge } from '@/shared/types/IBridge';
import type { IApp, IModule, IConfigField, ICatalogData } from '@/shared/types/coreTypes';
import type { AppConfig, ModuleItem, ApiProvider } from '@/shared/types/bindings';
import { logger } from './LoggerService';
import { FALLBACK_CONFIG } from '@/shared/config/catalog_fallback';

import type { TGlobalWin } from '@/shared/types/global_bridge_types';

export class CatalogService {
    private readonly _appData: ICatalogData = { ai: [], services: [] };

    constructor(private readonly _bridge: IBridge) {
        // Architectural compliance Section 51
        this._initGlobalExposures();
    }

    /**
     * Initializes global access patterns only where necessary.
     */
    private _initGlobalExposures(): void {
        const win = globalThis as TGlobalWin;

        // KISS: Use dev-only global for debugging
        if (import.meta.env.DEV) {
            (win as any).__DEV_CATALOG = this;
        }

        // Sync with global APP_DATA for downstream components
        win.APP_DATA = this._appData;

        // Expose category resolver for AppUI type safety
        win.getCatalogCategory = (cat: string): IApp[] => {
            if (cat === 'ai') return this._appData.ai;
            if (cat === 'services') return this._appData.services;
            return [];
        };
    }

    /**
     * Asynchronously loads the application catalog from the Tauri backend.
     */
    public async loadCatalog(): Promise<void> {
        // 1. Fetch Config and Modules
        const [config, installedModules] = await Promise.all([
            this._loadConfig(),
            this._loadInstalledModules(),
        ]);

        const validConfig = this._ensureValidConfig(config);

        try {
            if (validConfig.catalog) {
                this._appData.stars = validConfig.catalog.stars ?? [];

                const ai = validConfig.catalog.ai;
                const services = validConfig.catalog.services;

                logger.info(
                    `[CatalogService] Mapping config - AI: ${String(ai.length)}, Services: ${String(services.length)}`,
                );

                this._appData.ai = this._mapModuleItems(ai, 'ai');
                this._appData.services = this._mapModuleItems(services, 'services');

                logger.info(
                    `[CatalogService] After mapping - AI: ${String(this._appData.ai.length)}, Services: ${String(this._appData.services.length)}`,
                );

                // Hydrate with schemas & providers
                this._hydrateApps(validConfig, installedModules);

                // Final check for fallbacks
                this._ensureFallbacks();

                this._syncToGlobal();

                logger.info(
                    `[CatalogService] Catalog hydrated successfully. AI: ${String(this._appData.ai.length)}, Services: ${String(this._appData.services.length)}`,
                );

                const event = new CustomEvent('catalog-loaded');
                globalThis.dispatchEvent(event);
            } else {
                logger.warn('[CatalogService] Config missing catalog property!');
            }

            if (validConfig.models) {
                this._updateLegacySettings(validConfig.models);
            }

            logger.info(
                `[CatalogService] Catalog initialized. AI: ${String(this._appData.ai.length)}, Services: ${String(this._appData.services.length)}`,
            );
        } catch (e) {
            logger.error(`[CatalogService] Failed to load catalog: ${String(e)}`);
        }
    }

    /**
     * Loads the configuration from backend or fallback.
     */
    private async _loadConfig(): Promise<AppConfig> {
        try {
            if (this._bridge.isTauri()) {
                return await this._bridge.invoke<AppConfig>('get_config');
            } else {
                const res = await fetch('/api/config');
                return res.ok ? ((await res.json()) as AppConfig) : FALLBACK_CONFIG;
            }
        } catch (e) {
            logger.warn(`[CatalogService] Backend config failed, using fallback: ${String(e)}`);
            return FALLBACK_CONFIG;
        }
    }

    /**
     * Loads the list of installed modules.
     */
    private async _loadInstalledModules(): Promise<IModule[]> {
        try {
            if (this._bridge.isTauri()) {
                const modules = await this._bridge.invoke<IModule[]>('get_modules');
                logger.info(`[CatalogService] Fetched ${String(modules.length)} modules.`);
                return modules;
            } else {
                const res = await fetch('/api/modules');
                return res.ok ? ((await res.json()) as IModule[]) : [];
            }
        } catch (e) {
            logger.warn(`[CatalogService] Module list failed: ${String(e)}`);
            return [];
        }
    }

    /**
     * Maps raw module items to IApp format.
     */
    private _mapModuleItems(items: ModuleItem[], category: 'ai' | 'services'): IApp[] {
        return items.map((item) => {
            return {
                id: item.id,
                nameKey: item.nameKey,
                descKey: item.descKey,
                name: item.name,
                desc: item.desc,
                icon: item.icon,
                category: category,
                type: category === 'ai' && item.type !== 'local' ? 'api' : 'local',
                repoUrl: item.repoUrl ?? '',
                expectedHash: item.expectedHash ?? '',
                version: item.version ?? '1.0.0',
                installed: (item as any).installed ?? false,
            } as IApp;
        });
    }

    /**
     * Hydrates apps with schemas, providers, and model data.
     */
    private _hydrateApps(config: AppConfig, installedModules: IModule[]): void {
        const installedMap = new Map(installedModules.map((m) => [m.id.toLowerCase(), m]));

        const mergeAppSchema = (app: IApp) => {
            const isApi =
                app.type === 'api' ||
                (config.apiProviders?.some((p: ApiProvider) => p.id === app.id) ?? false);

            if (isApi) app.installed = true;

            const provider = config.apiProviders?.find((p: ApiProvider) => p.id === app.id);
            if (provider) {
                app.apiProviderData = { ...provider };
            }

            const modelsRecord = config.models;
            if (isApi && modelsRecord?.[app.id] !== undefined) {
                app.apiProviderData ??= { id: app.id, name: app.name };
                app.apiProviderData['models'] = modelsRecord[app.id];
            }

            const inst = installedMap.get(app.id.toLowerCase());
            if (inst?.configSchema) {
                app.configSchema = inst.configSchema as unknown as Record<string, IConfigField>;
            }
        };

        this._appData.ai.forEach(mergeAppSchema);
        this._appData.services.forEach(mergeAppSchema);
    }

    /**
     * Ensures each category has at least one app from fallbacks if empty.
     */
    private _ensureFallbacks(): void {
        const mergeAppSchema = (app: IApp) => {
            // Simplified merge for fallback injection if needed
            if (app.type === 'api') app.installed = true;
        };

        const fallbackAi = FALLBACK_CONFIG.catalog.ai;
        const fallbackServices = FALLBACK_CONFIG.catalog.services;

        if (this._appData.ai.length === 0) {
            logger.warn(`[CatalogService] AI catalog still empty (fallback source has ${String(fallbackAi.length)} items), injecting fallbacks.`);
            this._appData.ai = this._mapModuleItems(fallbackAi, 'ai');
            this._appData.ai.forEach(mergeAppSchema);
            logger.info(`[CatalogService] AI catalog now has ${String(this._appData.ai.length)} items.`);
        }

        if (this._appData.services.length === 0) {
            logger.warn(`[CatalogService] Services catalog still empty (fallback source has ${String(fallbackServices.length)} items), injecting fallbacks.`);
            this._appData.services = this._mapModuleItems(fallbackServices, 'services');
            this._appData.services.forEach(mergeAppSchema);
            logger.info(`[CatalogService] Services catalog now has ${String(this._appData.services.length)} items.`);
        }
    }

    /**
     * Returns the current catalog data.
     */
    public getCatalog(): ICatalogData {
        return this._appData;
    }

    /**
     * Retrieves an app by its ID from the catalog.
     */
    public getAppById(id: string): IApp | undefined {
        return (
            this._appData.ai.find((a) => a.id === id) ??
            this._appData.services.find((s) => s.id === id)
        );
    }

    /**
     * Synchronizes internal state to global state.
     */
    private _syncToGlobal(): void {
        const globalAppData = globalThis.APP_DATA;
        globalAppData.ai = this._appData.ai;
        globalAppData.services = this._appData.services;
        if (this._appData.stars !== undefined) {
            globalAppData.stars = this._appData.stars;
        }
    }

    /**
     * Updates legacy module settings from config.
     */
    private _updateLegacySettings(models: unknown): void {
        const win = globalThis as TGlobalWin;
        const updateFn = win.updateModuleSettings; // Assuming this exists or add to IGlobalBridge?
        if (typeof updateFn === 'function' && models !== undefined && models !== null) {
            try {
                updateFn(models as Record<string, unknown>);
            } catch {
                logger.warn('[CatalogService] Warning updating module settings');
            }
        }
    }

    /**
     * Validates the configuration and returns a fallback if invalid.
     */
    private _ensureValidConfig(config: AppConfig | null): AppConfig {
        const fallback = FALLBACK_CONFIG;

        const isCatalogEmpty =
            !config?.catalog ||
            ((config.catalog.ai?.length ?? 0) === 0 &&
                (config.catalog.services?.length ?? 0) === 0);

        if (isCatalogEmpty) {
            const aiLen = config?.catalog?.ai?.length ?? 0;
            const srvLen = config?.catalog?.services?.length ?? 0;
            logger.warn(
                `[CatalogService] Config invalid or empty (AI: ${String(aiLen)}, Services: ${String(srvLen)}). FORCING FALLBACK_CONFIG.`,
            );
            return fallback;
        }

        logger.info(
            `[CatalogService] _ensureValidConfig passed (AI: ${String(config?.catalog?.ai?.length ?? 0)}, Services: ${String(config?.catalog?.services?.length ?? 0)})`,
        );
        return config;
    }
}
