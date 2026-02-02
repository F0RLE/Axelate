/**
 * @module ai/utils/catalogHelpers
 * @description Utility functions for accessing AI provider data from global APP_DATA.
 */

import type { IAICatalogApp, IAIModelData, IAIProviderData, IAIModelStats } from '../types/aiTypes';

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

    return appData.ai.find((app) => app.id === providerId) || null;
}

/**
 * Aggregates provider-specific metadata, including available model clusters.
 *
 * @param providerId - Unique identifier for the AI provider
 * @returns Provider metadata object or null
 */
export function getProviderData(providerId: string): IAIProviderData | null {
    const provider = getProviderFromCatalog(providerId);
    return provider?.apiProviderData || null;
}

// ============================================================================
// Model Access
// ============================================================================

/**
 * Extracts the comprehensive model map for the specified provider.
 *
 * @param providerId - Provider identifier
 * @returns Record map of model data
 */
export function getModelsFromProvider(providerId: string): Record<string, IAIModelData> {
    const providerData = getProviderData(providerId);
    return providerData?.models || {};
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
    return models[modelKey] || null;
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
    return modelData?.apiModels?.text || uiModelKey;
}

// ============================================================================
// Model Sorting & Selection
// ============================================================================

/**
 * Computes a heuristic performance index based on logical and creative heuristics.
 *
 * @param stats - Model performance metrics
 * @returns Aggregate power score
 */
function _calculatePower(stats?: IAIModelStats): number {
    return (stats?.logic || 0) + (stats?.creative || 0);
}

/**
 * Ranks models according to their computed performance indices in descending order.
 *
 * @param models - Record of models to sort
 * @returns Array of sorted entries
 */
export function sortModelsByPower(models: Record<string, IAIModelData>): [string, IAIModelData][] {
    return Object.entries(models).sort(([, modelA], [, modelB]) => {
        return _calculatePower(modelB.stats) - _calculatePower(modelA.stats);
    });
}

/**
 * Identifies the highest-ranked model within the provider's catalog.
 *
 * @param providerId - Provider identifier
 * @returns Key of the most powerful model
 */
export function getMostPowerfulModel(providerId: string): string {
    const models = getModelsFromProvider(providerId);
    const sorted = sortModelsByPower(models);
    return sorted.length > 0 ? sorted[0][0] : '';
}

/**
 * Resolves the preferred model by auditing local state and falling back to catalog rankings.
 *
 * @param providerId - Provider identifier
 * @returns Effective model key
 */
export function getSelectedModel(providerId: string): string {
    const saved = localStorage.getItem(`${providerId}_selected_model`);
    return saved || getMostPowerfulModel(providerId);
}

// ============================================================================
// Provider Type Mapping
// ============================================================================

/**
 * Transports logical provider identifiers to infrastructure-specific backend tokens.
 *
 * @param providerId - Logical provider identifier
 * @returns Backend-compatible provider type
 */
export function mapProviderToBackend(providerId: string): string {
    const providerData = getProviderData(providerId);

    if (providerData?.type) {
        return providerData.type === 'api' ? 'openai' : providerData.type;
    }

    const legacyMap: Record<string, string> = {
        gpt: 'openai',
        gemini: 'gemini',
        local: 'local',
    };

    return legacyMap[providerId] || providerId;
}

