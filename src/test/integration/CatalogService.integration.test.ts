/**
 * @module test/integration/CatalogService.integration.test.ts
 * @description Integration tests for CatalogService — verifies full lifecycle
 * from bridge calls through catalog hydration to globalThis sync.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CatalogService } from '@/shared/services/CatalogService';
import type { IModule, ICatalogData } from '@/shared/types/coreTypes';
import type { AppConfig } from '@/shared/types/bindings';
import { FALLBACK_CONFIG } from '@/shared/config/catalog_fallback';
import type { IBridge } from '@/shared/types/IBridge';
import { createMockBridge } from '@/test/mocks/mockBridge';

function createMockAppConfig(overrides?: unknown): AppConfig {
    return {
        catalog: { ai: [], services: [] },
        apiProviders: [],
        autoStartModules: [],
        ...(overrides as Record<string, unknown>),
    } as unknown as AppConfig;
}

function setupBridgeMocks(
    bridge: { isTauri: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn> },
    config: AppConfig | null,
    modules: IModule[] = [],
) {
    bridge.isTauri.mockReturnValue(true);
    bridge.invoke.mockImplementation((cmd: string) => {
        if (cmd === 'get_config') return Promise.resolve(config);
        if (cmd === 'get_modules') return Promise.resolve(modules);
        if (cmd === 'get_engine_definitions') return Promise.resolve([]);
        return Promise.resolve(undefined);
    });
}

describe('CatalogService Integration', () => {
    let mockBridge: {
        isTauri: ReturnType<typeof vi.fn>;
        invoke: ReturnType<typeof vi.fn>;
        listen: ReturnType<typeof vi.fn>;
    };
    let service: CatalogService;

    beforeEach(() => {
        globalThis.APP_DATA = { ai: [], services: [] } as unknown as ICatalogData;
        globalThis.getCatalogCategory = vi.fn().mockReturnValue([]);
        globalThis.dispatchEvent = vi.fn();

        mockBridge = createMockBridge() as unknown as {
            isTauri: ReturnType<typeof vi.fn>;
            invoke: ReturnType<typeof vi.fn>;
            listen: ReturnType<typeof vi.fn>;
        };

        service = new CatalogService(mockBridge as unknown as IBridge);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should load full catalog with apps, schemas, and installed status', async () => {
        const mockConfig = createMockAppConfig({
            catalog: {
                ai: [{ id: 'llamacpp', name: 'Llama.cpp', type: 'local' }],
                services: [{ id: 'mybot', name: 'My Bot' }],
            },
        });

        const mockModules: IModule[] = [
            {
                id: 'llamacpp',
                configSchema: { ctx_size: { type: 'number', default: 4096 } },
            } as unknown as IModule,
        ];

        setupBridgeMocks(mockBridge, mockConfig, mockModules);

        await service.loadCatalog();

        const catalog = service.getCatalog();
        expect(catalog.ai).toHaveLength(1);
        expect(catalog.ai.at(0)?.id).toBe('llamacpp');
        expect(catalog.ai.at(0)?.configSchema).toBeDefined();
        expect(catalog.services).toHaveLength(1);
        expect(catalog.services.at(0)?.id).toBe('mybot');
    });

    it('should handle Tauri backend failure and use fallback', async () => {
        mockBridge.isTauri.mockReturnValue(true);
        mockBridge.invoke.mockResolvedValue(null);

        await service.loadCatalog();

        const catalog = service.getCatalog();
        // Fallback config should populate the catalog
        expect(catalog.ai.length).toBe(FALLBACK_CONFIG.catalog.ai.length);
    });

    it('should dispatch catalog-loaded event after successful load', async () => {
        const mockConfig = createMockAppConfig({
            catalog: { ai: [{ id: 'gpt', name: 'GPT' }], services: [] },
        });

        setupBridgeMocks(mockBridge, mockConfig);

        await service.loadCatalog();

        expect(globalThis.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'catalog-loaded' }),
        );
    });

    it('should handle empty config and keep empty catalog (fallback is also empty)', async () => {
        const mockConfig = createMockAppConfig({
            catalog: { ai: [], services: [] },
        });

        setupBridgeMocks(mockBridge, mockConfig);

        await service.loadCatalog();

        const catalog = service.getCatalog();
        // FALLBACK_CONFIG is also empty, so catalog stays empty
        expect(catalog.ai).toHaveLength(0);
        expect(catalog.services).toHaveLength(0);
    });

    it('should handle partial data — config OK but modules fail', async () => {
        const mockConfig = createMockAppConfig({
            catalog: {
                ai: [{ id: 'gpt', name: 'GPT', type: 'api' }],
                services: [{ id: 'bot', name: 'Bot' }],
            },
        });

        mockBridge.isTauri.mockReturnValue(true);
        mockBridge.invoke.mockImplementation((cmd: string) => {
            if (cmd === 'get_config') return Promise.resolve(mockConfig);
            if (cmd === 'get_modules') return Promise.reject(new Error('Backend down'));
            if (cmd === 'get_engine_definitions') return Promise.resolve([]);
            return Promise.resolve(undefined);
        });

        await service.loadCatalog();

        const catalog = service.getCatalog();
        expect(catalog.ai).toHaveLength(1);
        expect(catalog.ai.at(0)?.installed).toBe(true); // API modules always installed
    });

    it('should work in web mode with fetch fallback', async () => {
        mockBridge.isTauri.mockReturnValue(false);

        const webConfig = createMockAppConfig({
            catalog: {
                ai: [{ id: 'gemini', name: 'Gemini', type: 'api' }],
                services: [],
            },
        });

        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation((url: string) => {
                if (url === '/api/config') {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(webConfig) });
                }
                return Promise.resolve({ ok: false });
            }),
        );

        await service.loadCatalog();

        const catalog = service.getCatalog();
        expect(catalog.ai).toHaveLength(1);
        expect(catalog.ai.at(0)?.id).toBe('gemini');

        vi.unstubAllGlobals();
    });
});
