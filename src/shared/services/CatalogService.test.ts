import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CatalogService } from './CatalogService';
import type {
    CatalogAppItem,
    CatalogProviderPolicy,
    CatalogSnapshot,
} from '@/shared/types/bindings';
import {
    createCatalogHarness,
    createMockCatalogSnapshot,
    setupBridgeMocks,
    type MockCatalogBridge,
} from '@/test/helpers/catalogTestUtils';

function catalogItem(overrides: Partial<CatalogAppItem>): CatalogAppItem {
    return {
        id: 'item',
        nameKey: null,
        descKey: null,
        name: null,
        desc: null,
        icon: null,
        preview: null,
        category: 'services',
        type: 'local',
        capability: 'text',
        installed: false,
        installedComputeModes: [],
        repoUrl: null,
        expectedHash: null,
        dlType: null,
        comingSoon: false,
        managedExternally: false,
        version: '1.0.0',
        configSchema: null,
        settingsUi: null,
        apiProviderData: null,
        status: null,
        ...overrides,
    };
}

describe('CatalogService', () => {
    let mockBridge: MockCatalogBridge;
    let service: CatalogService;
    const expectedOpenAiPolicy: Partial<CatalogProviderPolicy> = {
        isCloudProvider: true,
        secretService: 'cloud_api_key',
        supportsInternetAccess: true,
    };

    beforeEach(() => {
        ({ mockBridge, service } = createCatalogHarness());
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Initialization', () => {
        it('initializes with empty catalog arrays', () => {
            const catalog = service.getCatalog();

            expect(catalog.ai).toEqual([]);
            expect(catalog.services).toEqual([]);
        });
    });

    describe('loadCatalog', () => {
        it('loads the backend-owned catalog snapshot through one command', async () => {
            const snapshot = createMockCatalogSnapshot({
                ai: [
                    catalogItem({
                        id: 'openai',
                        name: 'OpenAI',
                        category: 'ai',
                        type: 'api',
                        installed: true,
                        apiProviderData: {
                            id: 'openai',
                            name: 'OpenAI',
                            type: 'openai-compatible',
                            models: [],
                        },
                        providerPolicy: {
                            isCloudProvider: true,
                            isCustomProvider: false,
                            isCleanApp: false,
                            secretService: 'cloud_api_key',
                            keyProviderId: 'cloud',
                            keyProviderUrl: 'https://openrouter.ai/settings/keys',
                            usesCustomProviderKey: false,
                            showApiEndpointSelector: false,
                            showCustomModelComposer: false,
                            showModelStats: true,
                            supportsInternetAccess: true,
                            supportsThinking: false,
                            imageOnly: false,
                        },
                    }),
                ],
                services: [
                    catalogItem({
                        id: 'sample-integration',
                        name: 'Sample Integration',
                        desc: 'Runs external workflows.',
                        icon: 'plug',
                        installed: true,
                        settingsUi: 'settings-ui/index.html',
                        status: 'stopped',
                    }),
                ],
                stars: ['openai'],
            });

            setupBridgeMocks(mockBridge, snapshot);

            await service.loadCatalog();

            expect(mockBridge.invoke).toHaveBeenCalledTimes(1);
            expect(mockBridge.invoke).toHaveBeenCalledWith('get_catalog_snapshot');

            const catalog = service.getCatalog();
            expect(catalog.stars).toEqual(['openai']);
            expect(catalog.ai.at(0)).toMatchObject({
                id: 'openai',
                type: 'api',
                installed: true,
                apiProviderData: {
                    id: 'openai',
                    name: 'OpenAI',
                    type: 'openai-compatible',
                    models: [],
                },
            });
            expect(catalog.ai.at(0)?.providerPolicy).toMatchObject(expectedOpenAiPolicy);
            expect(catalog.services.at(0)).toMatchObject({
                id: 'sample-integration',
                category: 'services',
                type: 'local',
                installed: true,
                settingsUi: 'settings-ui/index.html',
                status: 'stopped',
            });
        });

        it('preserves backend decisions for coming soon and installed compute modes', async () => {
            setupBridgeMocks(
                mockBridge,
                createMockCatalogSnapshot({
                    ai: [
                        catalogItem({
                            id: 'future-image',
                            name: 'Future Image',
                            category: 'ai',
                            type: 'local',
                            capability: 'image',
                            comingSoon: true,
                            installed: false,
                        }),
                        catalogItem({
                            id: 'llamacpp',
                            name: 'Llama.cpp',
                            category: 'ai',
                            type: 'local',
                            installed: true,
                            installedComputeModes: ['gpu', 'cpu', 'bad-mode'],
                        }),
                    ],
                }),
            );

            await service.loadCatalog();

            expect(service.getAppById('future-image')).toMatchObject({
                comingSoon: true,
                installed: false,
                capability: 'image',
            });
            expect(service.getAppById('llamacpp')?.installedComputeModes).toEqual(['gpu', 'cpu']);
        });

        it('passes backend-provided schema, preview, and localized keys through to the UI model', async () => {
            setupBridgeMocks(
                mockBridge,
                createMockCatalogSnapshot({
                    services: [
                        catalogItem({
                            id: 'worker',
                            nameKey: 'catalog.worker.name',
                            descKey: 'catalog.worker.desc',
                            preview: {
                                title: 'Worker',
                                description: 'Worker integration',
                                sticker: '*',
                                image: null,
                            },
                            configSchema: {
                                timeout: {
                                    fieldType: 'number',
                                    label: 'Timeout',
                                    default: 30,
                                    required: false,
                                },
                            },
                        }),
                    ],
                }),
            );

            await service.loadCatalog();

            expect(service.getAppById('worker')).toMatchObject({
                nameKey: 'catalog.worker.name',
                descKey: 'catalog.worker.desc',
                preview: {
                    title: 'Worker',
                    description: 'Worker integration',
                    sticker: '*',
                },
                configSchema: {
                    timeout: {
                        fieldType: 'number',
                        label: 'Timeout',
                        default: 30,
                        required: false,
                    },
                },
            });
        });

        it('reloads the snapshot when backend reports integration folder changes', async () => {
            const firstSnapshot = createMockCatalogSnapshot({
                services: [catalogItem({ id: 'parser', name: 'Parser', installed: true })],
            });
            const secondSnapshot = createMockCatalogSnapshot({ services: [] });
            const listener = { integrationsChanged: null as null | (() => void) };
            let snapshotCalls = 0;

            mockBridge.isTauri.mockReturnValue(true);
            mockBridge.listen.mockImplementation((event: string, callback: () => void) => {
                if (event === 'integrations_changed') {
                    listener.integrationsChanged = callback;
                }
                return Promise.resolve(() => {});
            });
            mockBridge.invoke.mockImplementation((cmd: string) => {
                if (cmd !== 'get_catalog_snapshot') return Promise.resolve(undefined);
                snapshotCalls += 1;
                return Promise.resolve(snapshotCalls === 1 ? firstSnapshot : secondSnapshot);
            });

            await service.loadCatalog();
            await Promise.resolve();

            expect(service.getAppById('parser')).toBeDefined();

            if (listener.integrationsChanged === null) {
                throw new Error('integrations_changed listener was not registered');
            }

            listener.integrationsChanged();
            await new Promise((resolve) => globalThis.setTimeout(resolve, 0));

            expect(snapshotCalls).toBe(2);
            expect(service.getAppById('parser')).toBeUndefined();
            expect(mockBridge.listen).toHaveBeenCalledTimes(1);
        });

        it('uses an empty catalog when the backend snapshot is unavailable', async () => {
            setupBridgeMocks(mockBridge, null);

            await service.loadCatalog();

            expect(service.getCatalog().ai).toEqual([]);
            expect(service.getCatalog().services).toEqual([]);
            expect(globalThis.dispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'catalog-loaded' }),
            );
        });

        it('uses an empty catalog when the backend snapshot shape is malformed', async () => {
            setupBridgeMocks(mockBridge, {
                ai: null,
                services: undefined,
                stars: null,
            } as unknown as CatalogSnapshot);

            await service.loadCatalog();

            expect(service.getCatalog().ai).toEqual([]);
            expect(service.getCatalog().services).toEqual([]);
        });

        it('does not throw when snapshot processing fails', async () => {
            const snapshot = createMockCatalogSnapshot();
            Object.defineProperty(snapshot, 'stars', {
                get() {
                    throw new Error('Stars access fail');
                },
            });

            setupBridgeMocks(mockBridge, snapshot);

            await expect(service.loadCatalog()).resolves.not.toThrow();
        });
    });

    describe('getAppById', () => {
        it('returns undefined for unknown app id', () => {
            expect(service.getAppById('non-existent')).toBeUndefined();
        });

        it('retrieves apps by id after loading the snapshot', async () => {
            setupBridgeMocks(
                mockBridge,
                createMockCatalogSnapshot({
                    ai: [catalogItem({ id: 'ai-app', category: 'ai', type: 'api' })],
                    services: [catalogItem({ id: 'service-app' })],
                }),
            );

            await service.loadCatalog();

            expect(service.getAppById('ai-app')).toBeDefined();
            expect(service.getAppById('service-app')?.id).toBe('service-app');
        });
    });

    describe('watcher cleanup', () => {
        it('unsubscribes the integration watcher if destroy runs while binding is pending', async () => {
            let resolveListen: (unlisten: () => void) => void = () => {
                throw new Error('listen promise was not started');
            };
            const unlisten = vi.fn();

            setupBridgeMocks(mockBridge, createMockCatalogSnapshot());
            mockBridge.isTauri.mockReturnValue(true);
            mockBridge.listen.mockReturnValue(
                new Promise((resolve) => {
                    resolveListen = resolve;
                }),
            );

            const loadPromise = service.loadCatalog();
            service.destroy();
            resolveListen(unlisten);
            await loadPromise;
            await Promise.resolve();

            expect(unlisten).toHaveBeenCalledTimes(1);
        });
    });
});
