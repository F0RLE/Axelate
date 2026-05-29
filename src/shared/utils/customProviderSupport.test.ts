import { describe, expect, it } from 'vitest';

import {
    CUSTOM_IMAGE_PROVIDER_ID,
    CUSTOM_TEXT_PROVIDER_ID,
    getCustomProviderDisplayName,
    isCustomImageProviderId,
    isCustomProviderId,
    resolveCustomProviderBackendId,
} from './customProviderSupport';

describe('customProviderSupport', () => {
    it('resolves custom provider metadata and backend ids', () => {
        expect(isCustomProviderId(CUSTOM_TEXT_PROVIDER_ID)).toBe(true);
        expect(isCustomProviderId('gpt')).toBe(false);
        expect(isCustomImageProviderId(CUSTOM_IMAGE_PROVIDER_ID)).toBe(true);
        expect(isCustomImageProviderId(CUSTOM_TEXT_PROVIDER_ID)).toBe(false);
        expect(resolveCustomProviderBackendId(CUSTOM_TEXT_PROVIDER_ID)).toBe('gpt');
        expect(resolveCustomProviderBackendId(CUSTOM_IMAGE_PROVIDER_ID)).toBe('gpt-image');
        expect(resolveCustomProviderBackendId('claude')).toBe('claude');
        expect(getCustomProviderDisplayName(CUSTOM_TEXT_PROVIDER_ID)).toBe('Custom');
        expect(getCustomProviderDisplayName('claude')).toBeNull();
    });
});
