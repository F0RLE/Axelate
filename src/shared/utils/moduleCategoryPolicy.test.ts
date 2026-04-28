import { describe, expect, it } from 'vitest';

import { CategoryKey } from '@/shared/types/categoryKeys';
import {
    getAiSlotForCapability,
    getOtherAiSlot,
    isAiCategory,
    resolveCatalogCategory,
    resolveModalCategory,
} from './moduleCategoryPolicy';

describe('moduleCategoryPolicy', () => {
    it('normalizes AI categories for catalog and modal routing', () => {
        expect(isAiCategory(CategoryKey.AI_IMAGE)).toBe(true);
        expect(resolveCatalogCategory(CategoryKey.AI_IMAGE)).toBe(CategoryKey.AI);
        expect(resolveModalCategory(CategoryKey.AI)).toBe(CategoryKey.AI_TEXT);
    });

    it('maps AI capabilities to stable slot categories', () => {
        expect(getAiSlotForCapability('text')).toBe(CategoryKey.AI_TEXT);
        expect(getAiSlotForCapability('image')).toBe(CategoryKey.AI_IMAGE);
        expect(getOtherAiSlot(CategoryKey.AI_TEXT)).toBe(CategoryKey.AI_IMAGE);
    });
});
