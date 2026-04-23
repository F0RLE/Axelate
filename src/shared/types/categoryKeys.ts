/**
 * @module shared/types/categoryKeys
 * @description Central enum for module category keys used across the application.
 * Eliminates magic strings and provides type safety for category references.
 */

export const CategoryKey = {
    AI: 'ai',
    AI_TEXT: 'ai_text',
    AI_IMAGE: 'ai_image',
    SERVICES: 'services',
} as const;

export type TCategoryKey = (typeof CategoryKey)[keyof typeof CategoryKey];
