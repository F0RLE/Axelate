import { describe, expect, it, vi } from 'vitest';
import {
    getApiModelId,
    getModelData,
    getModelDataFromModels,
    getModelsFromProvider,
    getMostPowerfulModel,
    getProviderData,
    getProviderFromCatalog,
    getSelectedModel,
    resolveProviderModel,
    sortModelsByPrice,
} from './catalogHelpers';
import type { IAICatalogApp } from '../types/aiTypes';

const createAppMock = (id: string, models: unknown = null) =>
    ({
        id,
        apiProviderData: models === null ? null : { models },
    }) as unknown as IAICatalogApp;

describe('catalogHelpers', () => {
    const catalog: IAICatalogApp[] = [
        createAppMock('gemini', [
            { id: 'gemini-pro', apiModels: { text: 'models/gemini-pro' } },
            { id: 'gemini-ultra', apiModels: { text: 'models/gemini-ultra' } },
        ]),
        createAppMock('gpt'),
    ];

    describe('provider access', () => {
        it('returns provider app when present', () => {
            expect(getProviderFromCatalog(catalog, 'gemini')?.id).toBe('gemini');
        });

        it('returns null for unknown provider', () => {
            expect(getProviderFromCatalog(catalog, 'unknown')).toBeNull();
            expect(getProviderFromCatalog([], 'gemini')).toBeNull();
        });

        it('returns provider data when present', () => {
            expect(getProviderData(catalog, 'gemini')?.models).toHaveLength(2);
        });

        it('returns null when provider has no data', () => {
            expect(getProviderData(catalog, 'gpt')).toBeNull();
        });
    });

    describe('model access', () => {
        it('returns provider models', () => {
            expect(getModelsFromProvider(catalog, 'gemini')).toHaveLength(2);
            expect(getModelsFromProvider(catalog, 'gpt')).toEqual([]);
        });

        it('returns model data from model list', () => {
            const models = getModelsFromProvider(catalog, 'gemini');
            expect(getModelDataFromModels(models, 'gemini-ultra')?.apiModels?.text).toBe(
                'models/gemini-ultra',
            );
            expect(getModelDataFromModels(models, 'missing')).toBeNull();
        });

        it('returns model data from catalog', () => {
            expect(getModelData(catalog, 'gemini', 'gemini-pro')?.apiModels?.text).toBe(
                'models/gemini-pro',
            );
            expect(getModelData(catalog, 'gemini', 'missing')).toBeNull();
        });

        it('maps UI model key to API identifier', () => {
            expect(getApiModelId(catalog, 'gemini', 'gemini-ultra')).toBe('models/gemini-ultra');
            expect(getApiModelId(catalog, 'gemini', 'broken')).toBe('broken');
        });

        it('returns highest priced model as most powerful fallback', () => {
            const pricedCatalog: IAICatalogApp[] = [
                createAppMock('gpt', [
                    {
                        id: 'gpt-5.5',
                        pricing: { input: 5, output: 30 },
                    },
                    {
                        id: 'gpt-5.5-pro',
                        pricing: { input: 30, output: 180 },
                    },
                ]),
            ];

            expect(getMostPowerfulModel(pricedCatalog, 'gpt')).toBe('gpt-5.5-pro');
            expect(getMostPowerfulModel(catalog, 'gpt')).toBe('');
        });

        it('sorts models by total token price descending', () => {
            const models = [
                { id: 'free' },
                { id: 'regular', pricing: { input: 5, output: 30 } },
                { id: 'pro', pricing: { input: 30, output: 180 } },
            ];

            expect(sortModelsByPrice(models as never).map((model) => model.id)).toEqual([
                'pro',
                'regular',
                'free',
            ]);
        });

        it('prefers saved model before catalog fallback', () => {
            const getter = vi.fn().mockReturnValue('saved-model');
            expect(getSelectedModel(catalog, 'gemini', getter)).toBe('saved-model');
            expect(getSelectedModel(catalog, 'gemini', () => undefined)).toBe('gemini-pro');
        });
    });

    describe('resolveProviderModel', () => {
        const advancedCatalog: IAICatalogApp[] = [
            createAppMock('advanced', {
                'model-a': {
                    apiModels: { text: 'api-model-a' },
                    stats: { logic: 10, creative: 10 },
                },
                'model-b': {
                    apiModels: { text: 'api-model-b' },
                    stats: { logic: 20, creative: 15 },
                },
            }),
            createAppMock('empty'),
        ];

        it('uses saved model key when provided', () => {
            expect(resolveProviderModel('advanced', advancedCatalog, () => 'model-a')).toBe(
                'api-model-a',
            );
        });

        it('falls back to strongest model by stats', () => {
            expect(resolveProviderModel('advanced', advancedCatalog, () => '')).toBe('api-model-b');
            expect(resolveProviderModel('advanced', advancedCatalog)).toBe('api-model-b');
        });

        it('handles missing provider data', () => {
            expect(resolveProviderModel('empty', advancedCatalog)).toBe('');
        });

        it('handles models without stats gracefully', () => {
            const noStatsCatalog: IAICatalogApp[] = [
                createAppMock('nostats', {
                    'model-x': { apiModels: { text: 'api-x' } },
                    'model-y': { apiModels: { text: 'api-y' } },
                }),
            ];

            expect(['api-x', 'api-y']).toContain(resolveProviderModel('nostats', noStatsCatalog));
        });
    });
});
