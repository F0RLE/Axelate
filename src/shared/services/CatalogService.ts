/**
 * @module core/services/CatalogService
 * @description Manages the application catalog and configuration
 */

import type { IBridge } from '@/shared/types/IBridge';
import type { IApp, IModule, IConfigField, ICatalogData } from '@/shared/types/coreTypes';
import type { AppConfig, ModuleItem, ApiProvider } from '@/shared/types/bindings';
import { tracer } from '@/infrastructure/logging/LoggerService';
import { FALLBACK_CONFIG } from '@/shared/config/catalog_fallback';

export class CatalogService {
    private readonly _appData: ICatalogData = { ai: [], services: [] };

    constructor(private readonly _bridge: IBridge) {}

    /**
     * Asynchronously loads the application catalog from the Tauri backend.
     */
    public async loadCatalog(): Promise<void> {
        // 1. Fetch Config, Modules, and Engine Definitions in parallel
        const [config, installedModules, engineDefs] = await Promise.all([
            this._loadConfig(),
            this._loadInstalledModules(),
            this._loadEngineDefs(),
        ]);

        const validConfig = this._ensureValidConfig(config);

        try {
            this._appData.stars = validConfig.catalog.stars;

            const ai = validConfig.catalog.ai;
            const services = validConfig.catalog.services;

            tracer.info(
                `[CatalogService] Mapping config - AI: ${String(ai.length)}, Services: ${String(services.length)}`,
            );

            this._appData.ai = this._mapModuleItems(ai, 'ai');
            this._appData.services = this._mapModuleItems(services, 'services');

            tracer.info(
                `[CatalogService] After mapping - AI: ${String(this._appData.ai.length)}, Services: ${String(this._appData.services.length)}`,
            );

            // Hydrate with schemas, providers & engine install status
            this._hydrateApps(validConfig, installedModules, engineDefs);

            // Final check for fallbacks
            this._ensureFallbacks();

            tracer.info(
                `[CatalogService] Catalog hydrated successfully. AI: ${String(this._appData.ai.length)}, Services: ${String(this._appData.services.length)}`,
            );

            const event = new CustomEvent('catalog-loaded');
            globalThis.dispatchEvent(event);

            this._updateLegacySettings(validConfig.apiProviders);

            tracer.info(
                `[CatalogService] Catalog initialized. AI: ${String(this._appData.ai.length)}, Services: ${String(this._appData.services.length)}`,
            );
        } catch (e) {
            tracer.error(`[CatalogService] Failed to load catalog: ${String(e)}`);
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
            tracer.warn(`[CatalogService] Backend config failed, using fallback: ${String(e)}`);
            return FALLBACK_CONFIG;
        }
    }

    /**
     * Fetches engine definitions (with real-time `installed` status) from backend.
     */
    private async _loadEngineDefs(): Promise<Array<{ id: string; installed: boolean }>> {
        try {
            if (this._bridge.isTauri()) {
                return await this._bridge.invoke<Array<{ id: string; installed: boolean }>>(
                    'get_engine_definitions',
                );
            }
        } catch (e) {
            tracer.warn(`[CatalogService] Engine definitions unavailable: ${String(e)}`);
        }
        return [];
    }

    /**
     * Loads the list of installed modules.
     */
    private async _loadInstalledModules(): Promise<IModule[]> {
        try {
            if (this._bridge.isTauri()) {
                const modules = await this._bridge.invoke<IModule[]>('get_modules');
                tracer.info(`[CatalogService] Fetched ${String(modules.length)} modules.`);
                return modules;
            } else {
                const res = await fetch('/api/modules');
                return res.ok ? ((await res.json()) as IModule[]) : [];
            }
        } catch (e) {
            tracer.warn(`[CatalogService] Module list failed: ${String(e)}`);
            return [];
        }
    }

    /**
     * Maps raw module items to IApp format.
     */
    private _mapModuleItems(items: ModuleItem[], category: 'ai' | 'services'): IApp[] {
        return items.map((item) => {
            // Resolve capability from capabilities array (first match wins)
            const caps = (item as ModuleItem & { capabilities?: string[] }).capabilities ?? [];
            let capability: 'text' | 'image' = 'text';
            if (caps.includes('image')) capability = 'image';

            return {
                id: item.id,
                nameKey: item.nameKey,
                descKey: item.descKey,
                name: item.name,
                desc: item.desc,
                icon: item.icon,
                category: category,
                type: category === 'ai' && item.type !== 'local' ? 'api' : 'local',
                capability,
                repoUrl: item.repoUrl ?? '',
                expectedHash: item.expectedHash ?? '',
                dlType: item.dlType ?? undefined,
                version: item.version ?? '1.0.0',
                installed: (item as ModuleItem & { installed?: boolean }).installed ?? false,
            } as IApp;
        });
    }

    /**
     * Hydrates apps with schemas, providers, and model data.
     */
    private _hydrateApps(
        config: AppConfig,
        installedModules: IModule[],
        engineDefs: Array<{ id: string; installed: boolean }> = [],
    ): void {
        const installedMap = new Map(installedModules.map((m) => [m.id.toLowerCase(), m]));
        // Build a fast lookup for engine installation status
        const engineInstallMap = new Map(engineDefs.map((e) => [e.id.toLowerCase(), e.installed]));

        const mergeAppSchema = (app: IApp) => {
            const isApi =
                app.type === 'api' || config.apiProviders.some((p: ApiProvider) => p.id === app.id);
            const installedModule = installedMap.get(app.id.toLowerCase());

            if (isApi) {
                app.installed = true;
            } else if (app.type === 'local' && engineInstallMap.has(app.id.toLowerCase())) {
                // Use real-time detection from is_engine_installed()
                app.installed = engineInstallMap.get(app.id.toLowerCase()) ?? false;
            } else if (app.type === 'local' && installedModule) {
                // Non-engine local modules should render as installed immediately.
                // Otherwise the modal first paints the "download" style and only then
                // flips after a late async install check.
                app.installed = true;
            }

            const provider = config.apiProviders.find((p: ApiProvider) => p.id === app.id);
            if (provider) {
                app.apiProviderData = provider as unknown as Record<string, unknown>;
            }

            if (installedModule?.configSchema) {
                app.configSchema = installedModule.configSchema as unknown as Record<
                    string,
                    IConfigField
                >;
            }
        };

        this._appData.ai.forEach(mergeAppSchema);
        this._appData.services.forEach(mergeAppSchema);

        // Final sync for legacy components that expect a global model map
        this._updateLegacySettings(config.apiProviders);
    }

    /**
     * Ensures each category has at least one app from fallbacks if empty.
     */
    private _ensureFallbacks(): void {
        const fallbackAi = FALLBACK_CONFIG.catalog.ai;
        const fallbackServices = FALLBACK_CONFIG.catalog.services;

        if (this._appData.ai.length === 0) {
            tracer.warn(
                `[CatalogService] AI catalog still empty (fallback source has ${String(fallbackAi.length)} items), injecting fallbacks.`,
            );
            this._appData.ai = this._mapModuleItems(fallbackAi, 'ai');
            tracer.info(
                `[CatalogService] AI catalog now has ${String(this._appData.ai.length)} items.`,
            );
        }

        if (this._appData.services.length === 0) {
            tracer.warn(
                `[CatalogService] Services catalog still empty (fallback source has ${String(fallbackServices.length)} items), injecting fallbacks.`,
            );
            this._appData.services = this._mapModuleItems(fallbackServices, 'services');
            tracer.info(
                `[CatalogService] Services catalog now has ${String(this._appData.services.length)} items.`,
            );
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
     * Updates legacy module settings from config.
     */
    private _updateLegacySettings(_apiProviders: ApiProvider[]): void {
        tracer.info('[CatalogService] Legacy update settings deprecated.');
    }

    /**
     * Validates the configuration and returns a fallback if invalid.
     */
    private _ensureValidConfig(config: AppConfig | null): AppConfig {
        const fallback = FALLBACK_CONFIG;

        if (!config) {
            tracer.warn('[CatalogService] Config is null. Using FALLBACK_CONFIG.');
            return fallback;
        }

        if (config.catalog.ai.length === 0 && config.catalog.services.length === 0) {
            const aiLen = config.catalog.ai.length;
            const srvLen = config.catalog.services.length;
            tracer.warn(
                `[CatalogService] Config invalid or empty (AI: ${String(aiLen)}, Services: ${String(srvLen)}). FORCING FALLBACK_CONFIG.`,
            );
            return fallback;
        }

        tracer.info(
            `[CatalogService] _ensureValidConfig passed (AI: ${String(config.catalog.ai.length)}, Services: ${String(config.catalog.services.length)})`,
        );
        return config;
    }
}
