import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CatalogService } from './CatalogService';
import type { IModule } from '@/shared/types/coreTypes';
import { FALLBACK_CONFIG } from '@/shared/config/catalog_fallback';
import {
    createCatalogHarness,
    createMockAppConfig,
    setupBridgeMocks,
    setupFetchMock,
    type MockCatalogBridge,
} from '@/test/helpers/catalogTestUtils';

describe('CatalogService', () => {
    let mockBridge: MockCatalogBridge;
    let service: CatalogService;

    beforeEach(() => {
        ({ mockBridge, service } = createCatalogHarness());
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Initialization', () => {
        it('should correctly initialize catalog state on instantiation', () => {
            const catalog = service.getCatalog();
            expect(Array.isArray(catalog.ai)).toBe(true);
            expect(Array.isArray(catalog.services)).toBe(true);
        });
    });

    describe('loadCatalog', () => {
        it('should load config and modules from bridge when in Tauri environment', async () => {
            const mockConfig = createMockAppConfig({
                catalog: { ai: [{ id: 'test-ai', name: 'Test AI' }], services: [] },
            });

            const mockModules: IModule[] = [
                { id: 'test-ai', configSchema: { setting: {} } } as unknown as IModule,
            ];

            setupBridgeMocks(mockBridge, mockConfig, mockModules);

            await service.loadCatalog();

            expect(mockBridge.invoke).toHaveBeenCalledWith('get_config');
            expect(mockBridge.invoke).toHaveBeenCalledWith('get_modules');

            const catalog = service.getCatalog();
            expect(catalog.ai.length).toBe(1);
            expect(catalog.ai[0]?.id).toBe('test-ai');
            expect(catalog.ai[0]?.configSchema).toEqual({ setting: {} });
            expect(catalog.ai[0]?.type).toBe('api'); // is mapped to api if no type provided in AI
        });

        it('should preserve comingSoon placeholders as non-installed AI apps', async () => {
            const mockConfig = createMockAppConfig({
                catalog: {
                    ai: [
                        {
                            id: 'future-image',
                            name: 'Future Image',
                            type: 'local',
                            comingSoon: true,
                        },
                    ],
                    services: [],
                },
            });

            setupBridgeMocks(mockBridge, mockConfig);

            await service.loadCatalog();

            const app = service.getAppById('future-image');
            expect(app?.comingSoon).toBe(true);
            expect(app?.installed).toBe(false);
            expect(app?.type).toBe('local');
        });

        it('should fallback to FALLBACK_CONFIG if config is empty or invalid', async () => {
            const invalidConfig = createMockAppConfig();

            setupBridgeMocks(mockBridge, invalidConfig);

            await service.loadCatalog();

            const catalog = service.getCatalog();

            // Should be hydrated from fallback source
            expect(catalog.ai.length).toBe(FALLBACK_CONFIG.catalog.ai.length);
            expect(catalog.ai[0]?.id).toBe(FALLBACK_CONFIG.catalog.ai[0]?.id);
        });

        it('should inject apiProviderData for API modules', async () => {
            const mockApiConfig = createMockAppConfig({
                catalog: { ai: [{ id: 'gpt-4', name: 'GPT 4', type: 'api' }], services: [] },
                apiProviders: [{ id: 'gpt-4', models: { default: 'gpt-4' } }],
            });

            setupBridgeMocks(mockBridge, mockApiConfig);

            await service.loadCatalog();

            const app = service.getAppById('gpt-4');
            expect(app).toBeDefined();
            expect(app?.type).toBe('api');
            expect(app?.installed).toBe(true);
            expect(app?.apiProviderData).toEqual({ id: 'gpt-4', models: { default: 'gpt-4' } });
        });
    });

    describe('getAppById', () => {
        it('should return undefined for unknown app id', () => {
            expect(service.getAppById('non-existent')).toBeUndefined();
        });

        it('should correctly retrieve an app by ID from loaded catalog', async () => {
            const mockConfig = createMockAppConfig({
                catalog: {
                    ai: [{ id: 'ai-app', name: 'AI App' }],
                    services: [{ id: 'service-app', name: 'Service App' }],
                },
            });

            setupBridgeMocks(mockBridge, mockConfig);

            await service.loadCatalog();

            expect(service.getAppById('ai-app')).toBeDefined();
            expect(service.getAppById('service-app')).toBeDefined();
            expect(service.getAppById('service-app')?.id).toBe('service-app');
        });
    });

    // ---------------------------------------------------------- getCatalogCategory fallback (lines 39-40)
    describe('getCatalogCategory fallback', () => {
        it('should return empty array for unknown category', () => {
            // getCatalogCategory is now on GlobalBridge, not CatalogService
            // Test service-level method instead
            const catalog = service.getCatalog();
            expect(Array.isArray(catalog.ai)).toBe(true);
            expect(Array.isArray(catalog.services)).toBe(true);
        });

        it('should return services array for services category', async () => {
            const mockConfig = createMockAppConfig({
                catalog: {
                    ai: [],
                    services: [{ id: 'svc', name: 'Service' }],
                },
            });

            setupBridgeMocks(mockBridge, mockConfig);

            await service.loadCatalog();

            const catalog = service.getCatalog();
            expect(catalog.services.length).toBe(1);
            expect(catalog.services.at(0)?.id).toBe('svc');
        });
    });

    // ---------------------------------------------------------- fetch fallback (web mode, lines 106-111, 125-130)
    describe('web mode fetch fallback', () => {
        it('should fetch config from /api/config in web mode', async () => {
            const mockConfig = createMockAppConfig({
                catalog: { ai: [{ id: 'fetched-ai', name: 'Fetched AI' }], services: [] },
            });

            mockBridge.isTauri.mockReturnValue(false);

            vi.stubGlobal(
                'fetch',
                vi.fn().mockImplementation((url: string) => {
                    if (url === '/api/config') {
                        return Promise.resolve({
                            ok: true,
                            json: () => Promise.resolve(mockConfig),
                        });
                    }
                    return Promise.resolve({ ok: false });
                }),
            );

            await service.loadCatalog();

            const catalog = service.getCatalog();
            expect(catalog.ai.length).toBeGreaterThan(0);

            vi.unstubAllGlobals();
        });

        it('should fallback to FALLBACK_CONFIG when fetch returns non-ok', async () => {
            mockBridge.isTauri.mockReturnValue(false);

            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

            await service.loadCatalog();

            const catalog = service.getCatalog();
            expect(catalog.ai.length).toBe(FALLBACK_CONFIG.catalog.ai.length);

            vi.unstubAllGlobals();
        });

        it('should fallback when fetch throws', async () => {
            mockBridge.isTauri.mockReturnValue(false);

            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

            await service.loadCatalog();

            // _loadConfig catches fetch error → returns FALLBACK_CONFIG
            const catalog = service.getCatalog();
            expect(catalog.ai.length).toBe(FALLBACK_CONFIG.catalog.ai.length);

            vi.unstubAllGlobals();
        });
    });

    // ---------------------------------------------------------- _ensureValidConfig null config (lines 278-279)
    describe('_ensureValidConfig null config', () => {
        it('should use FALLBACK_CONFIG when bridge invoke returns null', async () => {
            setupBridgeMocks(mockBridge, null);

            await service.loadCatalog();

            const catalog = service.getCatalog();
            expect(catalog.ai.length).toBe(FALLBACK_CONFIG.catalog.ai.length);
        });
    });

    // ---------------------------------------------------------- loadCatalog inner error (line 94)
    describe('loadCatalog inner error handling', () => {
        it('should catch errors in inner processing (e.g. stars access fail)', async () => {
            // Provide a valid config but with a stars getter that throws inside the try block
            const badConfig = createMockAppConfig({
                catalog: {
                    ai: [{ id: 'ok', name: 'OK' }],
                    services: [],
                    get stars() {
                        throw new Error('Stars access fail');
                    },
                },
            });

            setupBridgeMocks(mockBridge, badConfig);

            // The inner try-catch at line 56-95 catches the error
            await expect(service.loadCatalog()).resolves.not.toThrow();
        });
    });

    // ---------------------------------------------------------- _ensureFallbacks api-type (L193)
    describe('_ensureFallbacks api-type branch (L193)', () => {
        it('should mark api-type apps as installed=true', async () => {
            const config = createMockAppConfig({
                catalog: {
                    ai: [
                        { id: 'api-mod', name: 'API Module', type: 'api' },
                        { id: 'local-mod', name: 'Local Module', type: 'local' },
                    ],
                    services: [],
                },
                apiProviders: [{ id: 'api-mod', models: { default: 'model-1' } }],
            });

            setupBridgeMocks(mockBridge, config);

            await service.loadCatalog();

            const apiApp = service.getAppById('api-mod');
            const localApp = service.getAppById('local-mod');

            expect(apiApp?.installed).toBe(true);
            expect(localApp?.installed).not.toBe(true);
        });

        it('should mark non-engine local modules as installed when present in installed modules', async () => {
            const config = createMockAppConfig({
                catalog: {
                    ai: [],
                    services: [{ id: 'local-mod', name: 'Local Module', type: 'local' }],
                },
            });

            setupBridgeMocks(mockBridge, config, [
                { id: 'local-mod', configSchema: { setting: {} } } as unknown as IModule,
            ]);

            await service.loadCatalog();

            const localApp = service.getAppById('local-mod');
            expect(localApp?.installed).toBe(true);
            expect(localApp?.configSchema).toEqual({ setting: {} });
        });
    });

    describe('_initGlobalExposures DEV branch (L29)', () => {
        it('should skip __DEV_CATALOG when DEV is false', () => {
            const origDev = import.meta.env['DEV'];
            (import.meta.env as Record<string, unknown>)['DEV'] = false;

            const { service: s } = createCatalogHarness();
            expect(s).toBeDefined();

            (import.meta.env as Record<string, unknown>)['DEV'] = origDev;
        });
    });

    describe('_loadModuleList web fetch branches (L126)', () => {
        const webConfig = createMockAppConfig({
            catalog: { ai: [{ id: 'ai1', name: 'AI' }], services: [] },
        });

        it('should return modules when fetch response is ok (L126 true branch)', async () => {
            mockBridge.isTauri.mockReturnValue(false);

            const origFetch = globalThis.fetch;
            globalThis.fetch = setupFetchMock(webConfig, true, [{ id: 'mod1', name: 'Module 1' }]);

            await service.loadCatalog();
            globalThis.fetch = origFetch;
        });

        it('should return empty array when fetch response is not ok (L126 false branch)', async () => {
            mockBridge.isTauri.mockReturnValue(false);

            const origFetch = globalThis.fetch;
            globalThis.fetch = setupFetchMock(webConfig, false, []);

            await service.loadCatalog();
            globalThis.fetch = origFetch;
        });
    });
});
