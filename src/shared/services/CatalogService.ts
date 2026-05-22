/**
 * @module core/services/CatalogService
 * @description Manages the application catalog and configuration
 */

import type { IBridge } from '@/shared/types/IBridge';
import type { IApp, IConfigField, ICatalogData } from '@/shared/types/coreTypes';
import type { CatalogAppItem, CatalogSnapshot } from '@/shared/types/bindings';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

type CatalogLogger = Pick<LoggerService, 'debug' | 'info' | 'warn' | 'error'>;
const EMPTY_SNAPSHOT: CatalogSnapshot = {
    ai: [],
    services: [],
    stars: [],
};

export class CatalogService {
    private readonly _appData: ICatalogData = { ai: [], services: [] };
    private _integrationWatcherUnlisten: (() => void) | null = null;
    private _integrationWatcherBinding = false;
    private _destroyed = false;

    constructor(
        private readonly _bridge: IBridge,
        private readonly _tracer: CatalogLogger,
    ) {}

    /**
     * Asynchronously loads the application catalog from the Tauri backend.
     */
    public async loadCatalog(): Promise<void> {
        this._destroyed = false;
        this._bindIntegrationWatcher();
        const snapshot = await this._loadSnapshot();

        try {
            this._appData.stars = snapshot.stars;
            this._appData.ai = snapshot.ai.map((item) => this._mapSnapshotItem(item));
            this._appData.services = snapshot.services.map((item) => this._mapSnapshotItem(item));

            const event = new CustomEvent('catalog-loaded');
            globalThis.dispatchEvent(event);
        } catch (e) {
            this._tracer.error(`[CatalogService] Failed to load catalog: ${String(e)}`);
        }
    }

    public destroy(): void {
        this._destroyed = true;
        this._integrationWatcherUnlisten?.();
        this._integrationWatcherUnlisten = null;
        this._integrationWatcherBinding = false;
    }

    private _bindIntegrationWatcher(): void {
        if (
            this._integrationWatcherBinding ||
            this._integrationWatcherUnlisten !== null ||
            !this._bridge.isTauri()
        ) {
            return;
        }

        this._integrationWatcherBinding = true;
        void this._bridge
            .listen('integrations_changed', () => {
                void this.loadCatalog();
            })
            .then((unlisten) => {
                if (this._destroyed) {
                    unlisten();
                    this._integrationWatcherBinding = false;
                    return;
                }
                this._integrationWatcherUnlisten = unlisten;
            })
            .catch((error: unknown) => {
                this._integrationWatcherBinding = false;
                this._tracer.warn(
                    `[CatalogService] Failed to subscribe to integrations watcher: ${String(error)}`,
                );
            });
    }

    private async _loadSnapshot(): Promise<CatalogSnapshot> {
        try {
            const snapshot = await this._bridge.invoke<CatalogSnapshot>('get_catalog_snapshot');
            return this._ensureValidSnapshot(snapshot);
        } catch (e) {
            this._tracer.warn(`[CatalogService] Backend catalog snapshot failed: ${String(e)}`);
            return EMPTY_SNAPSHOT;
        }
    }

    private _mapSnapshotItem(item: CatalogAppItem): IApp {
        const app: IApp = {
            id: item.id,
            preview: item.preview ?? null,
            category: item.category,
            type: item.type === 'api' ? 'api' : 'local',
            capability: item.capability === 'image' ? 'image' : 'text',
            installed: item.installed,
            installedComputeModes: this._mapComputeModes(item.installedComputeModes ?? []),
            repoUrl: item.repoUrl ?? '',
            expectedHash: item.expectedHash ?? '',
            comingSoon: item.comingSoon,
            managedExternally: item.managedExternally,
            version: item.version,
        };

        if (item.nameKey !== null) app.nameKey = item.nameKey;
        if (item.descKey !== null) app.descKey = item.descKey;
        if (item.name !== null) app.name = item.name;
        if (item.desc !== null) app.desc = item.desc;
        if (item.icon !== null) app.icon = item.icon;
        if (item.dlType !== null) app.dlType = item.dlType;
        if (item.configSchema !== null && item.configSchema !== undefined) {
            app.configSchema = item.configSchema as Record<string, IConfigField>;
        }
        if (item.settingsUi !== undefined) {
            app.settingsUi = item.settingsUi;
        }
        if (item.apiProviderData !== null && item.apiProviderData !== undefined) {
            app.apiProviderData = item.apiProviderData as Record<string, unknown>;
        }
        if (item.providerPolicy !== null && item.providerPolicy !== undefined) {
            app.providerPolicy = item.providerPolicy;
        }
        if (item.status !== undefined) {
            app.status = item.status;
        }

        return app;
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

    private _mapComputeModes(modes: string[]): Array<'gpu' | 'cpu'> {
        return modes.filter((mode): mode is 'gpu' | 'cpu' => mode === 'gpu' || mode === 'cpu');
    }

    private _ensureValidSnapshot(snapshot: CatalogSnapshot | null): CatalogSnapshot {
        if (!snapshot) {
            this._tracer.warn(
                '[CatalogService] Catalog snapshot is unavailable. Using empty catalog.',
            );
            return EMPTY_SNAPSHOT;
        }

        if (!this._hasSnapshotArrays(snapshot)) {
            this._tracer.warn(
                '[CatalogService] Catalog snapshot shape is invalid. Using empty catalog.',
            );
            return EMPTY_SNAPSHOT;
        }
        return snapshot;
    }

    private _hasSnapshotArrays(snapshot: CatalogSnapshot): boolean {
        const candidate = snapshot as unknown as {
            ai?: unknown;
            services?: unknown;
            stars?: unknown;
        };

        return (
            Array.isArray(candidate.ai) &&
            Array.isArray(candidate.services) &&
            Array.isArray(candidate.stars)
        );
    }
}
