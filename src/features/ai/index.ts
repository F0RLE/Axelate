/**
 * @module ai/index
 * @description AI Module Exports. Centralized entry point for AI functionality.
 */

// Main services
export { AIBridge } from './services/AIBridge';

// Core types
export type {
    MessageSource,
    MessageHandler,
    ChatContentPart,
    ChatContent,
    IChatMessage,
    IChatRequest,
    IChatResponse,
    IAIBridgeState,
    IAIProviderData,
    IAIModelData,
    IAIModelStats,
} from './types/aiTypes';

// Provider abstractions
export type { IAIProvider, IAIProviderConfig } from './providers/AIProvider';

// Utility functions
export {
    getProviderFromCatalog,
    getProviderData,
    getModelsFromProvider,
    getModelData,
    getApiModelId,
    getMostPowerfulModel,
    getSelectedModel,
} from './utils/catalogHelpers';

// UI Components
export { aiSettingsRenderer } from './ui/AISettingsRenderer';
