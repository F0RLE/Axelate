/**
 * @module test/integration/CatalogService.integration.test.ts
 * @description Integration tests for CatalogService snapshot loading lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CatalogService } from '@/shared/services/CatalogService';
import type { CatalogAppItem } from '@/shared/types/bindings';
import {
    createCatalogHarness,
    createMockCatalogSnapshot,
    setupBridgeMocks,
    type MockCatalogBridge,
} from '@/test/helpers/catalogTestUtils';

function item(overrides: Partial<CatalogAppItem>): CatalogAppItem {
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

describe('CatalogService Integration', () => {
    let mockBridge: MockCatalogBridge;
    let service: CatalogService;

    beforeEach(() => {
        ({ mockBridge, service } = createCatalogHarness());
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads full catalog data already assembled by the backend', async () => {
        setupBridgeMocks(
            mockBridge,
            createMockCatalogSnapshot({
                ai: [
                    item({
                        id: 'llamacpp',
                        name: 'Llama.cpp',
                        category: 'ai',
                        installed: true,
                        installedComputeModes: ['gpu'],
                        configSchema: {
                            ctx_size: {
                                fieldType: 'number',
                                label: 'Context size',
                                default: 4096,
                                required: false,
                            },
                        },
                    }),
                ],
                services: [item({ id: 'my-worker', name: 'My Worker', installed: true })],
            }),
        );

        await service.loadCatalog();

        const catalog = service.getCatalog();
        expect(catalog.ai).toHaveLength(1);
        expect(catalog.ai.at(0)).toMatchObject({
            id: 'llamacpp',
            installed: true,
            installedComputeModes: ['gpu'],
            configSchema: {
                ctx_size: {
                    fieldType: 'number',
                    label: 'Context size',
                    default: 4096,
                    required: false,
                },
            },
        });
        expect(catalog.services.at(0)?.id).toBe('my-worker');
    });

    it('handles backend failure with an empty catalog', async () => {
        mockBridge.isTauri.mockReturnValue(true);
        mockBridge.invoke.mockRejectedValue(new Error('Backend down'));

        await service.loadCatalog();

        const catalog = service.getCatalog();
        expect(catalog.ai).toHaveLength(0);
        expect(catalog.services).toHaveLength(0);
    });

    it('dispatches catalog-loaded after load completes', async () => {
        setupBridgeMocks(
            mockBridge,
            createMockCatalogSnapshot({
                ai: [item({ id: 'openai', name: 'OpenAI', category: 'ai', type: 'api' })],
            }),
        );

        await service.loadCatalog();

        expect(globalThis.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'catalog-loaded' }),
        );
    });

    it('keeps empty backend snapshots empty', async () => {
        setupBridgeMocks(mockBridge, createMockCatalogSnapshot());

        await service.loadCatalog();

        const catalog = service.getCatalog();
        expect(catalog.ai).toHaveLength(0);
        expect(catalog.services).toHaveLength(0);
    });
});
