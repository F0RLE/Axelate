import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CatalogService } from './CatalogService';
import type { IModule, ICatalogData } from '@/shared/types/coreTypes';
import type { AppConfig } from '@/shared/types/bindings';
import { FALLBACK_CONFIG } from '@/shared/config/catalog_fallback';
import type { IBridge } from '@/shared/types/IBridge';

describe('CatalogService', () => {
    let mockBridge: {
        isTauri: ReturnType<typeof vi.fn>;
        invoke: ReturnType<typeof vi.fn>;
        listen: ReturnType<typeof vi.fn>;
    };
    let service: CatalogService;

    beforeEach(() => {
        // Mock global window object
        globalThis.APP_DATA = { ai: [], services: [] } as unknown as ICatalogData;
        globalThis.getCatalogCategory = vi.fn();
        globalThis.dispatchEvent = vi.fn();
        globalThis.updateModuleSettings = vi.fn();

        mockBridge = {
            isTauri: vi.fn(),
            invoke: vi.fn(),
            listen: vi.fn(),
        };

        service = new CatalogService(mockBridge as unknown as IBridge);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Initialization', () => {
        it('should correctly expose global sync points on instantiation', () => {
            expect(globalThis.APP_DATA).toBeDefined();
            expect(typeof globalThis.getCatalogCategory).toBe('function');

            // Check that getCatalogCategory returns internal arrays
            const categoryReturn = globalThis.getCatalogCategory('ai');
            expect(Array.isArray(categoryReturn)).toBe(true);
        });
    });

    describe('loadCatalog', () => {
        it('should load config and modules from bridge when in Tauri environment', async () => {
            const mockConfig: AppConfig = {
                catalog: { ai: [{ id: 'test-ai', name: 'Test AI' }], services: [] },
                apiProviders: [],
                autoStartModules: [],
            } as unknown as AppConfig;

            const mockModules: IModule[] = [
                { id: 'test-ai', configSchema: { setting: {} } } as unknown as IModule,
            ];

            mockBridge.isTauri.mockReturnValue(true);
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_config') return Promise.resolve(mockConfig);
                if (cmd === 'get_modules') return Promise.resolve(mockModules);
                return Promise.resolve(undefined);
            });

            await service.loadCatalog();

            expect(mockBridge.invoke).toHaveBeenCalledWith('get_config');
            expect(mockBridge.invoke).toHaveBeenCalledWith('get_modules');

            const catalog = service.getCatalog();
            expect(catalog.ai.length).toBe(1);
            expect(catalog.ai[0]?.id).toBe('test-ai');
            expect(catalog.ai[0]?.configSchema).toEqual({ setting: {} });
            expect(catalog.ai[0]?.type).toBe('api'); // is mapped to api if no type provided in AI
        });

        it('should fallback to FALLBACK_CONFIG if config is empty or invalid', async () => {
            const invalidConfig: AppConfig = {
                catalog: { ai: [], services: [] },
                apiProviders: [],
                autoStartModules: [],
            } as unknown as AppConfig;

            mockBridge.isTauri.mockReturnValue(true);
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_config') return Promise.resolve(invalidConfig);
                if (cmd === 'get_modules') return Promise.resolve([]);
                return Promise.resolve(undefined);
            });

            await service.loadCatalog();

            const catalog = service.getCatalog();

            // Should be hydrated from fallback source
            expect(catalog.ai.length).toBe(FALLBACK_CONFIG.catalog.ai.length);
            expect(catalog.ai[0]?.id).toBe(FALLBACK_CONFIG.catalog.ai[0]?.id);
        });

        it('should inject apiProviderData for API modules', async () => {
            const mockApiConfig: AppConfig = {
                catalog: { ai: [{ id: 'gpt-4', name: 'GPT 4', type: 'api' }], services: [] },
                apiProviders: [{ id: 'gpt-4', models: { default: 'gpt-4' } }],
                autoStartModules: [],
            } as unknown as AppConfig;

            mockBridge.isTauri.mockReturnValue(true);
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_config') return Promise.resolve(mockApiConfig);
                if (cmd === 'get_modules') return Promise.resolve([]);
                return Promise.resolve(undefined);
            });

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
            const mockConfig: AppConfig = {
                catalog: {
                    ai: [{ id: 'ai-app', name: 'AI App' }],
                    services: [{ id: 'service-app', name: 'Service App' }],
                },
                apiProviders: [],
                autoStartModules: [],
            } as unknown as AppConfig;

            mockBridge.isTauri.mockReturnValue(true);
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_config') return Promise.resolve(mockConfig);
                if (cmd === 'get_modules') return Promise.resolve([]);
                return Promise.resolve(undefined);
            });

            await service.loadCatalog();

            expect(service.getAppById('ai-app')).toBeDefined();
            expect(service.getAppById('service-app')).toBeDefined();
            expect(service.getAppById('service-app')?.id).toBe('service-app');
        });
    });

    // ---------------------------------------------------------- getCatalogCategory fallback (lines 39-40)
    describe('getCatalogCategory fallback', () => {
        it('should return empty array for unknown category', () => {
            const result = globalThis.getCatalogCategory('unknown');
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(0);
        });

        it('should return services array for services category', async () => {
            const mockConfig: AppConfig = {
                catalog: {
                    ai: [],
                    services: [{ id: 'svc', name: 'Service' }],
                },
                apiProviders: [],
                autoStartModules: [],
            } as unknown as AppConfig;

            mockBridge.isTauri.mockReturnValue(true);
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_config') return Promise.resolve(mockConfig);
                if (cmd === 'get_modules') return Promise.resolve([]);
                return Promise.resolve(undefined);
            });

            await service.loadCatalog();

            const result = globalThis.getCatalogCategory('services');
            expect(Array.isArray(result)).toBe(true);
        });
    });

    // ---------------------------------------------------------- fetch fallback (web mode, lines 106-111, 125-130)
    describe('web mode fetch fallback', () => {
        it('should fetch config from /api/config in web mode', async () => {
            const mockConfig: AppConfig = {
                catalog: { ai: [{ id: 'fetched-ai', name: 'Fetched AI' }], services: [] },
                apiProviders: [],
                autoStartModules: [],
            } as unknown as AppConfig;

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
            mockBridge.isTauri.mockReturnValue(true);
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_config') return Promise.resolve(null);
                if (cmd === 'get_modules') return Promise.resolve([]);
                return Promise.resolve(undefined);
            });

            await service.loadCatalog();

            const catalog = service.getCatalog();
            expect(catalog.ai.length).toBe(FALLBACK_CONFIG.catalog.ai.length);
        });
    });

    // ---------------------------------------------------------- loadCatalog inner error (line 94)
    describe('loadCatalog inner error handling', () => {
        it('should catch errors in inner processing (e.g. stars access fail)', async () => {
            // Provide a valid config but with a stars getter that throws inside the try block
            const badConfig: AppConfig = {
                catalog: {
                    ai: [{ id: 'ok', name: 'OK' }],
                    services: [],
                    get stars() {
                        throw new Error('Stars access fail');
                    },
                },
                apiProviders: [],
                autoStartModules: [],
            } as unknown as AppConfig;

            mockBridge.isTauri.mockReturnValue(true);
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_config') return Promise.resolve(badConfig);
                if (cmd === 'get_modules') return Promise.resolve([]);
                return Promise.resolve(undefined);
            });

            // The inner try-catch at line 56-95 catches the error
            await expect(service.loadCatalog()).resolves.not.toThrow();
        });
    });

    // ---------------------------------------------------------- _updateLegacySettings error (line 266)
    describe('_updateLegacySettings error path', () => {
        it('should handle updateModuleSettings throwing without crashing', async () => {
            globalThis.updateModuleSettings = vi.fn().mockImplementation(() => {
                throw new Error('Hook failed');
            });

            const mockConfig: AppConfig = {
                catalog: { ai: [{ id: 'ai', name: 'AI' }], services: [] },
                apiProviders: [{ id: 'ai', models: ['m1'] }],
                autoStartModules: [],
            } as unknown as AppConfig;

            mockBridge.isTauri.mockReturnValue(true);
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_config') return Promise.resolve(mockConfig);
                if (cmd === 'get_modules') return Promise.resolve([]);
                return Promise.resolve(undefined);
            });

            await expect(service.loadCatalog()).resolves.not.toThrow();
        });
    });

    // ---------------------------------------------------------- _ensureFallbacks api-type (L193)
    describe('_ensureFallbacks api-type branch (L193)', () => {
        it('should mark api-type apps as installed=true', async () => {
            const config: AppConfig = {
                catalog: {
                    ai: [
                        { id: 'api-mod', name: 'API Module', type: 'api' },
                        { id: 'local-mod', name: 'Local Module', type: 'local' },
                    ],
                    services: [],
                },
                apiProviders: [{ id: 'api-mod', models: { default: 'model-1' } }],
                autoStartModules: [],
            } as unknown as AppConfig;

            mockBridge.isTauri.mockReturnValue(true);
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_config') return Promise.resolve(config);
                if (cmd === 'get_modules') return Promise.resolve([]);
                return Promise.resolve(undefined);
            });

            await service.loadCatalog();

            const apiApp = service.getAppById('api-mod');
            const localApp = service.getAppById('local-mod');

            expect(apiApp?.installed).toBe(true);
            expect(localApp?.installed).not.toBe(true);
        });
    });
});
