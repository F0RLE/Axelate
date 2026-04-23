/**
 * @module ai/utils/catalogHelpers
 * @description Pure utility functions for resolving AI provider and model data from the catalog.
 */

import type { IAICatalogApp, IAIModelData, IAIProviderData } from '../types/aiTypes';

// ============================================================================
// Provider Access
// ============================================================================

/**
 * Retrieves the provider application instance from the global catalog segment.
 *
 * @param catalog - AI catalog slice
 * @param providerId - Unique identifier for the AI provider
 * @returns Catalog application record or null
 */
export function getProviderFromCatalog(
    catalog: IAICatalogApp[],
    providerId: string,
): IAICatalogApp | null {
    return catalog.find((app) => app.id === providerId) ?? null;
}

/**
 * Aggregates provider-specific metadata, including available model clusters.
 *
 * @param catalog - AI catalog slice
 * @param providerId - Unique identifier for the AI provider
 * @returns Provider metadata object or null
 */
export function getProviderData(
    catalog: IAICatalogApp[],
    providerId: string,
): IAIProviderData | null {
    const provider = getProviderFromCatalog(catalog, providerId);
    return provider?.apiProviderData ?? null;
}

// ============================================================================
// Model Access
// ============================================================================

/**
 * Extracts the comprehensive model map for the specified provider.
 *
 * @param catalog - AI catalog slice
 * @param providerId - Provider identifier
 * @returns Array of model data
 */
export function getModelsFromProvider(
    catalog: IAICatalogApp[],
    providerId: string,
): IAIModelData[] {
    const providerData = getProviderData(catalog, providerId);
    return providerData?.models ?? [];
}

/**
 * Locates specific model data records within the provider's context.
 *
 * @param models - Provider model list
 * @param modelKey - Unique model key
 * @returns Model metadata or null
 */
export function getModelDataFromModels(
    models: IAIModelData[],
    modelKey: string,
): IAIModelData | null {
    return models.find((model) => model.id === modelKey) ?? null;
}

/**
 * Locates specific model data records within the provider's context.
 *
 * @param catalog - AI catalog slice
 * @param providerId - Provider identifier
 * @param modelKey - Unique model key
 * @returns Model metadata or null
 */
export function getModelData(
    catalog: IAICatalogApp[],
    providerId: string,
    modelKey: string,
): IAIModelData | null {
    return getModelDataFromModels(getModelsFromProvider(catalog, providerId), modelKey);
}

/**
 * Determines the authoritative model identifier for external API invocations.
 *
 * @param catalog - AI catalog slice
 * @param providerId - Provider identifier
 * @param uiModelKey - UI-friendly model key
 * @returns Verbatim API model identifier
 */
export function getApiModelId(
    catalog: IAICatalogApp[],
    providerId: string,
    uiModelKey: string,
): string {
    const modelData = getModelData(catalog, providerId, uiModelKey);
    return modelData?.apiModels?.text ?? uiModelKey;
}

export function getMostPowerfulModel(catalog: IAICatalogApp[], providerId: string): string {
    const models = getModelsFromProvider(catalog, providerId);
    return models[0]?.id ?? '';
}

/**
 * Resolves the preferred model by checking injected state, then falling back to catalog rankings.
 * The `modelGetter` is provided by the caller (e.g. AISettingsService) to avoid
 * direct localStorage coupling in this utility module.
 *
 * @param catalog - AI catalog slice
 * @param providerId - Provider identifier
 * @param modelGetter - Optional function to retrieve persisted model selection from app state
 * @returns Effective model key
 */
export function getSelectedModel(
    catalog: IAICatalogApp[],
    providerId: string,
    modelGetter?: (providerId: string) => string | undefined,
): string {
    const saved = modelGetter?.(providerId);
    return saved ?? getMostPowerfulModel(catalog, providerId);
}

// ============================================================================
// Model Resolution (full pipeline: saved state → API ID)
// ============================================================================

interface IProviderModelEntry {
    apiModels?: { text?: string };
    stats?: { logic?: number; creative?: number };
}

/**
 * Resolves the full API model ID for a provider, using saved state or the most powerful model.
 * Encapsulates the complete resolution pipeline so callers (e.g. GlobalBridge) stay thin.
 *
 * @param providerId - Provider identifier
 * @param catalog - AI catalog app list
 * @param modelGetter - Optional function to retrieve persisted model selection from app state
 * @returns API model identifier string
 */
export function resolveProviderModel(
    providerId: string,
    catalog: IAICatalogApp[],
    modelGetter?: (providerId: string) => string | undefined,
): string {
    const providerApp = catalog.find((a) => a.id === providerId);
    const data = providerApp?.apiProviderData as
        | { models?: Record<string, IProviderModelEntry> }
        | undefined;
    const models: Record<string, IProviderModelEntry> = data?.models ?? {};

    // 1. Saved model key from state
    const savedKey = modelGetter?.(providerId);
    const resolvedKey =
        savedKey !== undefined && savedKey !== '' ? savedKey : _mostPowerfulModelKey(models);

    // 2. Map to API ID
    return models[resolvedKey]?.apiModels?.text ?? resolvedKey;
}

function _mostPowerfulModelKey(models: Record<string, IProviderModelEntry>): string {
    const sorted = Object.keys(models).sort((a, b) => {
        const sA = models[a]?.stats;
        const sB = models[b]?.stats;
        return (sB?.logic ?? 0) + (sB?.creative ?? 0) - ((sA?.logic ?? 0) + (sA?.creative ?? 0));
    });
    return sorted[0] ?? '';
}
