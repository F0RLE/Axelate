/**
 * @module core/services/CatalogService
 * @description Manages the application catalog and configuration
 */

import type { IBridge } from '@/shared/types/IBridge';
import type { IApp, IModule, IConfigField, ICatalogData } from '@/shared/types/coreTypes';
import type { AppConfig, ModuleItem, ApiProvider } from '@/shared/types/bindings';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { FALLBACK_CONFIG } from '@/shared/config/catalog_fallback';
import type { CatalogLoadSnapshot, EngineDefinition } from './CatalogLoadSnapshot';

type CatalogLogger = Pick<LoggerService, 'info' | 'warn' | 'error'>;

export class CatalogService {
    private readonly _appData: ICatalogData = { ai: [], services: [] };

    constructor(
        private readonly _bridge: IBridge,
        private readonly _tracer: CatalogLogger,
    ) {}

    /**
     * Asynchronously loads the application catalog from the Tauri backend.
     */
    public async loadCatalog(): Promise<void> {
        const snapshot = await this._loadSnapshot();

        try {
            this._appData.stars = snapshot.config.catalog.stars;

            const ai = snapshot.config.catalog.ai;
            const services = snapshot.config.catalog.services;

            this._appData.ai = this._mapModuleItems(ai, 'ai');
            this._appData.services = this._mapModuleItems(services, 'services');

            // Hydrate with schemas, providers & engine install status
            this._hydrateApps(snapshot.config, snapshot.installedModules, snapshot.engineDefs);

            // Final check for fallbacks
            this._ensureFallbacks();

            const event = new CustomEvent('catalog-loaded');
            globalThis.dispatchEvent(event);
        } catch (e) {
            this._tracer.error(`[CatalogService] Failed to load catalog: ${String(e)}`);
        }
    }

    private async _loadSnapshot(): Promise<CatalogLoadSnapshot> {
        const [config, installedModules, engineDefs] = await Promise.all([
            this._loadConfig(),
            this._loadInstalledModules(),
            this._loadEngineDefs(),
        ]);

        return {
            config: this._ensureValidConfig(config),
            installedModules,
            engineDefs,
        };
    }

    /**
     * Loads the configuration from backend or fallback.
     */
    private async _loadConfig(): Promise<AppConfig> {
        try {
            return await this._bridge.invoke<AppConfig>('get_config');
        } catch (e) {
            this._tracer.warn(
                `[CatalogService] Backend config failed, using fallback: ${String(e)}`,
            );
            return FALLBACK_CONFIG;
        }
    }

    /**
     * Fetches engine definitions (with real-time `installed` status) from backend.
     */
    private async _loadEngineDefs(): Promise<EngineDefinition[]> {
        try {
            if (this._bridge.isTauri()) {
                return await this._bridge.invoke<EngineDefinition[]>('get_engine_definitions');
            }
        } catch (e) {
            this._tracer.warn(`[CatalogService] Engine definitions unavailable: ${String(e)}`);
        }
        return [];
    }

    /**
     * Loads the list of installed modules.
     */
    private async _loadInstalledModules(): Promise<IModule[]> {
        try {
            const modules = await this._bridge.invoke<IModule[]>('get_modules');
            return modules;
        } catch (e) {
            this._tracer.warn(`[CatalogService] Module list failed: ${String(e)}`);
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
                preview: item.preview ?? null,
                category: category,
                type: category === 'ai' && item.type !== 'local' ? 'api' : 'local',
                capability,
                repoUrl: item.repoUrl ?? '',
                expectedHash: item.expectedHash ?? '',
                dlType: item.dlType ?? undefined,
                comingSoon: (item as ModuleItem & { comingSoon?: boolean }).comingSoon === true,
                managedExternally:
                    (item as ModuleItem & { managedExternally?: boolean }).managedExternally ===
                    true,
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
        engineDefs: EngineDefinition[] = [],
    ): void {
        const installedMap = new Map(installedModules.map((m) => [m.id.toLowerCase(), m]));
        // Build a fast lookup for engine installation status
        const engineInstallMap = new Map(engineDefs.map((e) => [e.id.toLowerCase(), e.installed]));

        const mergeAppSchema = (app: IApp) => {
            const isApi =
                app.type === 'api' || config.apiProviders.some((p: ApiProvider) => p.id === app.id);
            const installedModule = installedMap.get(app.id.toLowerCase());

            if (app.comingSoon === true) {
                app.installed = false;
                return;
            }

            if (app.managedExternally === true) {
                app.installed = true;
            }

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

            if (installedModule?.settingsUi !== undefined) {
                app.settingsUi = installedModule.settingsUi;
            }

            if (installedModule?.preview !== undefined) {
                app.preview = installedModule.preview;
            }
        };

        this._appData.ai.forEach(mergeAppSchema);
        this._appData.services.forEach(mergeAppSchema);
        this._appendDiscoveredIntegrations(installedModules);
    }

    private _appendDiscoveredIntegrations(installedModules: IModule[]): void {
        const knownIds = new Set(
            [...this._appData.ai, ...this._appData.services].map((app) => app.id.toLowerCase()),
        );

        const discovered = installedModules
            .filter((module) => !knownIds.has(module.id.toLowerCase()))
            .map((module) => this._mapInstalledIntegration(module));

        if (discovered.length === 0) return;

        this._appData.services.push(...discovered);
        this._tracer.info(
            `[CatalogService] Added ${String(discovered.length)} discovered integration(s).`,
        );
    }

    private _mapInstalledIntegration(module: IModule): IApp {
        return {
            id: module.id,
            name: module.preview?.title ?? module.name,
            desc: module.preview?.description ?? module.description,
            icon: module.preview?.sticker ?? module.icon,
            preview: module.preview ?? null,
            category: 'services',
            type: 'local',
            capability: 'text',
            repoUrl: '',
            expectedHash: '',
            comingSoon: false,
            managedExternally: false,
            version: module.version,
            installed: true,
            configSchema: module.configSchema as unknown as Record<string, IConfigField>,
            settingsUi: module.settingsUi,
            status: module.status,
        };
    }

    /**
     * Ensures each category has at least one app from fallbacks if empty.
     */
    private _ensureFallbacks(): void {
        const fallbackAi = FALLBACK_CONFIG.catalog.ai;
        const fallbackServices = FALLBACK_CONFIG.catalog.services;

        if (this._appData.ai.length === 0) {
            this._tracer.warn(
                `[CatalogService] AI catalog still empty (fallback source has ${String(fallbackAi.length)} items), injecting fallbacks.`,
            );
            this._appData.ai = this._mapModuleItems(fallbackAi, 'ai');
            this._tracer.info(
                `[CatalogService] AI catalog now has ${String(this._appData.ai.length)} items.`,
            );
        }

        if (this._appData.services.length === 0) {
            this._tracer.warn(
                `[CatalogService] Services catalog still empty (fallback source has ${String(fallbackServices.length)} items), injecting fallbacks.`,
            );
            this._appData.services = this._mapModuleItems(fallbackServices, 'services');
            this._tracer.info(
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
     * Validates the configuration and returns a fallback if invalid.
     */
    private _ensureValidConfig(config: AppConfig | null): AppConfig {
        const fallback = FALLBACK_CONFIG;

        if (!config) {
            this._tracer.warn('[CatalogService] Config is null. Using FALLBACK_CONFIG.');
            return fallback;
        }

        if (config.catalog.ai.length === 0 && config.catalog.services.length === 0) {
            const aiLen = config.catalog.ai.length;
            const srvLen = config.catalog.services.length;
            this._tracer.warn(
                `[CatalogService] Config invalid or empty (AI: ${String(aiLen)}, Services: ${String(srvLen)}). FORCING FALLBACK_CONFIG.`,
            );
            return fallback;
        }
        return config;
    }
}
