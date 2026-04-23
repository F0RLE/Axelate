import { describe, expect, it } from 'vitest';

import {
    CUSTOM_IMAGE_PROVIDER_ID,
    CUSTOM_TEXT_PROVIDER_ID,
    appendCustomProviderApps,
    getCustomProviderDisplayName,
    isCustomImageProviderId,
    isCustomProviderId,
    resolveCustomProviderBackendId,
} from './customProviderSupport';

describe('customProviderSupport', () => {
    it('appends custom text and image providers once', () => {
        const result = appendCustomProviderApps([
            {
                id: 'gpt',
                name: 'GPT',
                type: 'api',
                capability: 'text',
                installed: true,
            },
        ]);

        expect(result.map((app) => app.id)).toEqual([
            'gpt',
            CUSTOM_TEXT_PROVIDER_ID,
            CUSTOM_IMAGE_PROVIDER_ID,
        ]);
        expect(
            appendCustomProviderApps(result).filter((app) => app.id === CUSTOM_TEXT_PROVIDER_ID),
        ).toHaveLength(1);
    });

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
