/**
 * @module ai/utils/catalogHelpers
 * @description Utility functions for accessing AI provider data from global APP_DATA.
 */

import type { IAICatalogApp, IAIModelData, IAIProviderData } from '../types/aiTypes';

// ============================================================================
// Global Access
// ============================================================================

/**
 * Internal interface for global state auditing.
 */
interface IGlobalWithAppData {
    APP_DATA?: {
        ai?: IAICatalogApp[];
    };
}

/**
 * Retrieves the global execution context with catalog typing.
 */
function _getGlobal(): IGlobalWithAppData {
    return globalThis as unknown as IGlobalWithAppData;
}

// ============================================================================
// Provider Access
// ============================================================================

/**
 * Retrieves the provider application instance from the global catalog segment.
 *
 * @param providerId - Unique identifier for the AI provider
 * @returns Catalog application record or null
 */
export function getProviderFromCatalog(providerId: string): IAICatalogApp | null {
    const appData = _getGlobal().APP_DATA;
    if (!appData?.ai) return null;

    return appData.ai.find((app) => app.id === providerId) ?? null;
}

/**
 * Aggregates provider-specific metadata, including available model clusters.
 *
 * @param providerId - Unique identifier for the AI provider
 * @returns Provider metadata object or null
 */
export function getProviderData(providerId: string): IAIProviderData | null {
    const provider = getProviderFromCatalog(providerId);
    return provider?.apiProviderData ?? null;
}

// ============================================================================
// Model Access
// ============================================================================

/**
 * Extracts the comprehensive model map for the specified provider.
 *
 * @param providerId - Provider identifier
 * @returns Array of model data
 */
export function getModelsFromProvider(providerId: string): IAIModelData[] {
    const providerData = getProviderData(providerId);
    return providerData?.models ?? [];
}

/**
 * Locates specific model data records within the provider's context.
 *
 * @param providerId - Provider identifier
 * @param modelKey - Unique model key
 * @returns Model metadata or null
 */
export function getModelData(providerId: string, modelKey: string): IAIModelData | null {
    const models = getModelsFromProvider(providerId);
    return models.find((m) => m.id === modelKey) ?? null;
}

/**
 * Determines the authoritative model identifier for external API invocations.
 *
 * @param providerId - Provider identifier
 * @param uiModelKey - UI-friendly model key
 * @returns Verbatim API model identifier
 */
export function getApiModelId(providerId: string, uiModelKey: string): string {
    const modelData = getModelData(providerId, uiModelKey);
    return modelData?.apiModels?.text ?? uiModelKey;
}

export function getMostPowerfulModel(providerId: string): string {
    const models = getModelsFromProvider(providerId);
    return models[0]?.id ?? '';
}

/**
 * Resolves the preferred model by checking injected state, then falling back to catalog rankings.
 * The `modelGetter` is provided by the caller (e.g. AISettingsService) to avoid
 * direct localStorage coupling in this utility module.
 *
 * @param providerId - Provider identifier
 * @param modelGetter - Optional function to retrieve persisted model selection from app state
 * @returns Effective model key
 */
export function getSelectedModel(
    providerId: string,
    modelGetter?: (providerId: string) => string | undefined,
): string {
    const saved = modelGetter?.(providerId);
    return saved ?? getMostPowerfulModel(providerId);
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
