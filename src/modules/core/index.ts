/**
 * @module core/index
 * @description Central export point for core platform services and utilities.
 * Complies with Section 19.3 (Public API export) of Axelate Standards.
 */

export { eventBus } from './services/EventBus';
export { errorHandler } from './services/ErrorHandler';
export { logger } from './services/LoggerService';
export { templateLoader } from './services/TemplateLoader';

// Types
export type * from './types/coreTypes';
