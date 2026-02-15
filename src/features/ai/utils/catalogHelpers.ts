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
 * @returns Record map of model data
 */
export function getModelsFromProvider(providerId: string): Record<string, IAIModelData> {
    const providerData = getProviderData(providerId);
    return providerData?.models ?? {};
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
    return models[modelKey] ?? null;
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

// ============================================================================
// Model Sorting & Selection
// ============================================================================

/**
 * Computes a heuristic performance index based on logical and creative heuristics.
 *
 * @param stats - Model performance metrics
 * @returns Aggregate power score
 */

/**
 * Ranks models according to their computed performance indices in descending order.
 * Deterministic hierarchy: Tier (Strong > Medium > Weak) -> Power Score (Logic + Creative) -> Release Date.
 *
 * @param models - Record of models to sort
 * @returns Array of sorted entries
 */
export function sortModelsByPower(models: Record<string, IAIModelData>): [string, IAIModelData][] {
    const tierPriority: Record<string, number> = {
        strong: 3,
        medium: 2,
        weak: 1,
    };

    /**
     * Converts a release date string (e.g. "2026-02") to a numeric timestamp for comparison.
     */
    const getTimestamp = (date?: string) => {
        if (!date) return 0;
        return new Date(date).getTime();
    };

    return Object.entries(models).sort(([, modelA], [, modelB]) => {
        // 1. Tier Priority (Strong > Medium > Weak)
        const tierA = modelA.tier?.toLowerCase() ?? 'weak';
        const tierB = modelB.tier?.toLowerCase() ?? 'weak';
        const tierDiff = (tierPriority[tierB] ?? 0) - (tierPriority[tierA] ?? 0);
        if (tierDiff !== 0) return tierDiff;

        // 2. Release Date (Newest > Oldest)
        const dateDiff =
            getTimestamp(modelB.releaseDate as string) - getTimestamp(modelA.releaseDate as string);
        if (dateDiff !== 0) return dateDiff;

        // 3. Power Score (Logic + Creative + Speed)
        const statsA = modelA.stats ?? { logic: 0, creative: 0, speed: 0 };
        const statsB = modelB.stats ?? { logic: 0, creative: 0, speed: 0 };
        const powerA = (statsA.logic ?? 0) + (statsA.creative ?? 0) + (statsA.speed ?? 0);
        const powerB = (statsB.logic ?? 0) + (statsB.creative ?? 0) + (statsB.speed ?? 0);
        const powerDiff = powerB - powerA;
        if (powerDiff !== 0) return powerDiff;

        // 4. Alphabetical Fallback (A-Z)
        return modelA.name.localeCompare(modelB.name);
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
    const first = sorted[0];
    return first ? first[0] : '';
}

/**
 * Resolves the preferred model by auditing local state and falling back to catalog rankings.
 *
 * @param providerId - Provider identifier
 * @returns Effective model key
 */
export function getSelectedModel(providerId: string): string {
    const saved = localStorage.getItem(`${providerId}_selected_model`);
    return saved ?? getMostPowerfulModel(providerId);
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

    return legacyMap[providerId] ?? providerId;
}
