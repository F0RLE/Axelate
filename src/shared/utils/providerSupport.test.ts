import { describe, expect, it } from 'vitest';

import {
    getSharedCloudSecretService,
    isCloudProviderId,
    resolveProviderSecretService,
} from './providerSupport';
import { CUSTOM_IMAGE_PROVIDER_ID, CUSTOM_TEXT_PROVIDER_ID } from './customProviderSupport';

describe('providerSupport', () => {
    it('maps supported cloud providers to the shared OpenRouter secret', () => {
        expect(getSharedCloudSecretService()).toBe('openrouter_api_key');
        expect(resolveProviderSecretService('gpt')).toBe('openrouter_api_key');
        expect(resolveProviderSecretService('gemini')).toBe('openrouter_api_key');
        expect(resolveProviderSecretService(CUSTOM_TEXT_PROVIDER_ID)).toBe('openrouter_api_key');
        expect(resolveProviderSecretService(CUSTOM_IMAGE_PROVIDER_ID)).toBe('openrouter_api_key');
    });

    it('does not create frontend-managed secret slots for unknown providers', () => {
        expect(isCloudProviderId('local-runtime')).toBe(false);
        expect(resolveProviderSecretService('local-runtime')).toBeNull();
        expect(resolveProviderSecretService('unknown-provider')).toBeNull();
    });
});
