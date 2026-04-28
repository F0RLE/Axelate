import { CategoryKey } from '@/shared/types/categoryKeys';

export type AiCapability = 'text' | 'image';
export type AiSlotCategory = typeof CategoryKey.AI_TEXT | typeof CategoryKey.AI_IMAGE;

export const AI_SLOT_BY_CAPABILITY: Record<AiCapability, AiSlotCategory> = {
    text: CategoryKey.AI_TEXT,
    image: CategoryKey.AI_IMAGE,
};

export function isAiSlotCategory(category: string): category is AiSlotCategory {
    return category === CategoryKey.AI_TEXT || category === CategoryKey.AI_IMAGE;
}

export function isAiCategory(category: string): boolean {
    return category === CategoryKey.AI || isAiSlotCategory(category);
}

export function getAiSlotForCapability(capability: AiCapability): AiSlotCategory {
    return AI_SLOT_BY_CAPABILITY[capability];
}

export function getOtherAiSlot(category: string): AiSlotCategory {
    return category === CategoryKey.AI_IMAGE ? CategoryKey.AI_TEXT : CategoryKey.AI_IMAGE;
}

export function resolveCatalogCategory(category: string): string {
    return isAiCategory(category) ? CategoryKey.AI : category;
}

export function resolveModalCategory(category: string): string {
    return category === CategoryKey.AI ? CategoryKey.AI_TEXT : category;
}

export function resolveModalSidebarCategory(category: string): string {
    return isAiCategory(category) ? CategoryKey.AI : category;
}
