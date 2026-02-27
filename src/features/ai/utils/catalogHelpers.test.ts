import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getProviderFromCatalog,
    getProviderData,
    getModelsFromProvider,
    getModelData,
    getApiModelId,
    getMostPowerfulModel,
    getSelectedModel,
    resolveProviderModel,
} from './catalogHelpers';
import type { IAICatalogApp } from '../types/aiTypes';

describe('catalogHelpers', () => {
    beforeEach(() => {
        // Mock global APP_DATA
        (globalThis as unknown as Record<string, unknown>)['APP_DATA'] = {
            ai: [
                {
                    id: 'gemini',
                    apiProviderData: {
                        models: [
                            { id: 'gemini-pro', apiModels: { text: 'models/gemini-pro' } },
                            { id: 'gemini-ultra', apiModels: { text: 'models/gemini-ultra' } },
                        ],
                    },
                },
                {
                    id: 'gpt',
                    apiProviderData: null, // Edge case: Data missing
                },
            ],
        };
    });

    afterEach(() => {
        (globalThis as unknown as Record<string, unknown>)['APP_DATA'] = undefined;
    });

    describe('Global Access', () => {
        it('should handle undefined APP_DATA gracefully', () => {
            (globalThis as unknown as Record<string, unknown>)['APP_DATA'] = undefined;
            expect(getProviderFromCatalog('gemini')).toBeNull();
        });

        it('should handle undefined APP_DATA.ai gracefully', () => {
            (globalThis as unknown as Record<string, unknown>)['APP_DATA'] = {};
            expect(getProviderFromCatalog('gemini')).toBeNull();
        });
    });

    describe('Provider Access', () => {
        it('getProviderFromCatalog should return correct app', () => {
            const app = getProviderFromCatalog('gemini');
            expect(app?.id).toBe('gemini');
        });

        it('getProviderFromCatalog should return null for deeply unknown provider', () => {
            expect(getProviderFromCatalog('unknown')).toBeNull();
        });

        it('getProviderData should return apiProviderData', () => {
            const data = getProviderData('gemini');
            expect(data?.models).toHaveLength(2);
        });

        it('getProviderData should return null if provider not found or has no data', () => {
            expect(getProviderData('unknown')).toBeNull();
            expect(getProviderData('gpt')).toBeNull();
        });
    });

    describe('Model Access', () => {
        it('getModelsFromProvider should return array of models', () => {
            expect(getModelsFromProvider('gemini')).toHaveLength(2);
            expect(getModelsFromProvider('gpt')).toEqual([]);
            expect(getModelsFromProvider('unknown')).toEqual([]);
        });

        it('getModelData should return correct model', () => {
            const model = getModelData('gemini', 'gemini-ultra');
            expect(model?.apiModels?.text).toBe('models/gemini-ultra');
        });

        it('getModelData should return null if model not found', () => {
            expect(getModelData('gemini', 'unknown-model')).toBeNull();
        });

        it('getApiModelId should return api identifier', () => {
            expect(getApiModelId('gemini', 'gemini-ultra')).toBe('models/gemini-ultra');
        });

        it('getApiModelId should return original string if api object missing', () => {
            // Mock edge case where apiModels doesn't exist
            (globalThis as unknown as Record<string, unknown>)['APP_DATA'] = {
                ai: [
                    (globalThis as unknown as { APP_DATA: { ai: unknown[] } })['APP_DATA'].ai[0],
                    ...((): unknown[] => {
                        const appData = (
                            globalThis as unknown as { APP_DATA?: { ai?: unknown[] } }
                        )['APP_DATA'];
                        if (appData?.ai?.[0] !== undefined) {
                            (
                                appData.ai[0] as { apiProviderData: { models: unknown[] } }
                            ).apiProviderData.models.push({ id: 'broken-model' });
                        }
                        return [];
                    })(),
                ].filter(Boolean),
            };
            // Reset to original and push via index access
            const globalAny = globalThis as unknown as Record<string, unknown>;
            globalAny['APP_DATA'] = {
                ai: [
                    {
                        id: 'gemini',
                        apiProviderData: {
                            models: [
                                { id: 'gemini-pro', apiModels: { text: 'models/gemini-pro' } },
                                { id: 'gemini-ultra', apiModels: { text: 'models/gemini-ultra' } },
                                { id: 'broken-model' },
                            ],
                        },
                    },
                ],
            };
            expect(getApiModelId('gemini', 'broken-model')).toBe('broken-model');
        });

        it('getMostPowerfulModel should return first model id', () => {
            // Because our naive implementation just returns first element array mapped by ID
            expect(getMostPowerfulModel('gemini')).toBe('gemini-pro');
            expect(getMostPowerfulModel('gpt')).toBe('');
        });

        it('getSelectedModel should use saved value first', () => {
            const getter = vi.fn().mockReturnValue('saved-model');
            expect(getSelectedModel('gemini', getter)).toBe('saved-model');
            expect(getter).toHaveBeenCalledWith('gemini');
        });

        it('getSelectedModel should fallback to most powerful model if no saved value', () => {
            const getter = vi.fn().mockReturnValue(undefined);
            expect(getSelectedModel('gemini', getter)).toBe('gemini-pro');
        });
    });

    describe('resolveProviderModel', () => {
        const mockCatalog: IAICatalogApp[] = [
            {
                id: 'advanced',
                apiProviderData: {
                    models: {
                        'model-a': {
                            apiModels: { text: 'api-model-a' },
                            stats: { logic: 10, creative: 10 },
                        },
                        'model-b': {
                            apiModels: { text: 'api-model-b' },
                            stats: { logic: 20, creative: 15 },
                        },
                    },
                },
            } as unknown as IAICatalogApp,
            {
                id: 'empty',
                apiProviderData: null,
            } as unknown as IAICatalogApp,
        ];

        it('should use modelGetter value and map to API ID', () => {
            const getter = vi.fn().mockReturnValue('model-a');
            const result = resolveProviderModel('advanced', mockCatalog, getter);
            expect(result).toBe('api-model-a');
        });

        it('should use modelGetter value even if it lacks API mapping', () => {
            const getter = vi.fn().mockReturnValue('model-c'); // not in dict
            const result = resolveProviderModel('advanced', mockCatalog, getter);
            expect(result).toBe('model-c');
        });

        it('should calculate most powerful model if getter returns empty', () => {
            const getter = vi.fn().mockReturnValue('');
            const result = resolveProviderModel('advanced', mockCatalog, getter);
            // model-b has higher combined stats (35 vs 20)
            expect(result).toBe('api-model-b');
        });

        it('should calculate most powerful model if getter is undefined', () => {
            const result = resolveProviderModel('advanced', mockCatalog);
            expect(result).toBe('api-model-b');
        });

        it('should handle undefined provider data gracefully', () => {
            const result = resolveProviderModel('empty', mockCatalog);
            expect(result).toBe('');
        });

        it('should handle models without stats gracefully during sorting', () => {
            const noStatsCatalog: IAICatalogApp[] = [
                {
                    id: 'nostats',
                    apiProviderData: {
                        models: {
                            'model-x': { apiModels: { text: 'api-x' } }, // no stats
                            'model-y': { apiModels: { text: 'api-y' } }, // no stats
                        },
                    },
                } as unknown as IAICatalogApp,
            ];
            const result = resolveProviderModel('nostats', noStatsCatalog);
            // sort is stable or depends on engine, but it shouldn't crash and should return one of them
            expect(['api-x', 'api-y']).toContain(result);
        });

        it('should handle empty models gracefully', () => {
            const noModelsCatalog: IAICatalogApp[] = [
                { id: 'nomodels', apiProviderData: { models: {} } } as unknown as IAICatalogApp,
            ];
            const result = resolveProviderModel('nomodels', noModelsCatalog);
            expect(result).toBe('');
        });
    });
});
