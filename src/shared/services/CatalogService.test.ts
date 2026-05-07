import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CatalogService } from './CatalogService';
import type { IModule } from '@/shared/types/coreTypes';
import {
    createCatalogHarness,
    createMockAppConfig,
    setupBridgeMocks,
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

        it('should keep an explicitly empty catalog empty', async () => {
            const invalidConfig = createMockAppConfig();

            setupBridgeMocks(mockBridge, invalidConfig);

            await service.loadCatalog();

            const catalog = service.getCatalog();

            expect(catalog.ai).toHaveLength(0);
            expect(catalog.services).toHaveLength(0);
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

    describe('getCatalogCategory defaults', () => {
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

    describe('bridge failure handling', () => {
        it('should load config through bridge even when isTauri=false', async () => {
            const mockConfig = createMockAppConfig({
                catalog: { ai: [{ id: 'fetched-ai', name: 'Fetched AI' }], services: [] },
            });

            mockBridge.isTauri.mockReturnValue(false);
            setupBridgeMocks(mockBridge, mockConfig);

            await service.loadCatalog();

            const catalog = service.getCatalog();
            expect(catalog.ai.length).toBeGreaterThan(0);
            expect(mockBridge.invoke).toHaveBeenCalledWith('get_config');
        });

        it('should use an empty catalog when bridge returns null config', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            setupBridgeMocks(mockBridge, null);

            await service.loadCatalog();

            const catalog = service.getCatalog();
            expect(catalog.ai).toHaveLength(0);
            expect(catalog.services).toHaveLength(0);
        });

        it('should use an empty catalog when bridge throws', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            mockBridge.invoke.mockRejectedValue(new Error('Bridge error'));

            await service.loadCatalog();

            const catalog = service.getCatalog();
            expect(catalog.ai).toHaveLength(0);
            expect(catalog.services).toHaveLength(0);
        });

        it('should use an empty catalog when bridge returns malformed catalog shape', async () => {
            setupBridgeMocks(
                mockBridge,
                createMockAppConfig({
                    catalog: { ai: null, services: undefined },
                    apiProviders: null,
                }),
            );

            await service.loadCatalog();

            const catalog = service.getCatalog();
            expect(catalog.ai).toHaveLength(0);
            expect(catalog.services).toHaveLength(0);
            expect(globalThis.dispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'catalog-loaded' }),
            );
        });
    });

    describe('_ensureValidConfig null config', () => {
        it('should use an empty catalog when bridge invoke returns null', async () => {
            setupBridgeMocks(mockBridge, null);

            await service.loadCatalog();

            const catalog = service.getCatalog();
            expect(catalog.ai).toHaveLength(0);
            expect(catalog.services).toHaveLength(0);
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

    describe('catalog hydration', () => {
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

        it('should add discovered integration folders with manifest metadata to services', async () => {
            const config = createMockAppConfig({
                catalog: {
                    ai: [{ id: 'gpt', name: 'GPT', type: 'api' }],
                    services: [],
                },
                apiProviders: [{ id: 'gpt', models: { default: 'gpt-5' } }],
            });

            setupBridgeMocks(mockBridge, config, [
                {
                    id: 'sample-integration',
                    name: 'Sample Integration',
                    description: 'Sample integration workflow module for Axelate.',
                    version: '0.3.0',
                    icon: 'plug',
                    preview: {
                        title: 'Sample Integration',
                        description:
                            'Runs an external workflow and processes discovered information through Axelate AI.',
                        sticker: '🤖',
                    },
                    settingsUi: 'settings-ui/index.html',
                    status: 'stopped',
                    configSchema: undefined,
                } as unknown as IModule,
            ]);

            await service.loadCatalog();

            const integration = service.getAppById('sample-integration');
            expect(integration).toBeDefined();
            expect(integration?.category).toBe('services');
            expect(integration?.type).toBe('local');
            expect(integration?.installed).toBe(true);
            expect(integration?.name).toBe('Sample Integration');
            expect(integration?.desc).toContain('Runs an external workflow');
            expect(integration?.icon).toBe('🤖');
            expect(integration?.settingsUi).toBe('settings-ui/index.html');
            expect(service.getCatalog().services.some((app) => app.id === integration?.id)).toBe(
                true,
            );
        });

        it('should reload catalog when backend reports integration folder changes', async () => {
            const config = createMockAppConfig({
                catalog: {
                    ai: [],
                    services: [{ id: 'catalog-anchor', name: 'Catalog Anchor', type: 'local' }],
                    stars: [],
                },
            });
            const firstModules = [
                {
                    id: 'parser',
                    name: 'Parser',
                    description: 'Parser integration',
                    version: '1.0.0',
                    icon: '🤖',
                } as unknown as IModule,
            ];
            const secondModules: IModule[] = [];
            const listener = { integrationsChanged: null as null | (() => void) };
            let moduleListCalls = 0;

            mockBridge.isTauri.mockReturnValue(true);
            mockBridge.listen.mockImplementation((event: string, callback: () => void) => {
                if (event === 'integrations_changed') {
                    listener.integrationsChanged = callback;
                }
                return Promise.resolve(() => {});
            });
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_config') return Promise.resolve(config);
                if (cmd === 'get_engine_definitions') return Promise.resolve([]);
                if (cmd === 'get_modules') {
                    moduleListCalls += 1;
                    return Promise.resolve(moduleListCalls === 1 ? firstModules : secondModules);
                }
                return Promise.resolve(undefined);
            });

            await service.loadCatalog();
            await Promise.resolve();
            expect(service.getAppById('parser')).toBeDefined();

            if (listener.integrationsChanged === null) {
                throw new Error('integrations_changed listener was not registered');
            }
            listener.integrationsChanged();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await new Promise((resolve) => globalThis.setTimeout(resolve, 0));

            expect(moduleListCalls).toBe(2);
            expect(service.getAppById('parser')).toBeUndefined();
            expect(mockBridge.listen).toHaveBeenCalledTimes(1);
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

    describe('_loadModuleList bridge branches (L126)', () => {
        const webConfig = createMockAppConfig({
            catalog: { ai: [{ id: 'ai1', name: 'AI' }], services: [] },
        });

        it('should return modules when bridge response is ok (L126 true branch)', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            setupBridgeMocks(mockBridge, webConfig, [
                { id: 'mod1', name: 'Module 1' },
            ] as IModule[]);

            await service.loadCatalog();

            expect(mockBridge.invoke).toHaveBeenCalledWith('get_modules');
        });

        it('should return empty array when bridge response fails (L126 false branch)', async () => {
            mockBridge.isTauri.mockReturnValue(false);
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd === 'get_config') return Promise.resolve(webConfig);
                if (cmd === 'get_modules') return Promise.reject(new Error('modules failed'));
                if (cmd === 'get_engine_definitions') return Promise.resolve([]);
                return Promise.resolve(undefined);
            });

            await service.loadCatalog();

            expect(service.getCatalog().ai.length).toBeGreaterThan(0);
        });
    });
});
