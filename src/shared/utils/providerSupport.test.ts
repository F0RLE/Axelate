import { describe, expect, it } from 'vitest';

import {
    getSharedCloudSecretService,
    isCloudProviderId,
    resolveProviderSecretService,
} from './providerSupport';
import { CUSTOM_IMAGE_PROVIDER_ID, CUSTOM_TEXT_PROVIDER_ID } from './customProviderSupport';

describe('providerSupport', () => {
    it('maps built-in cloud providers to the shared OpenRouter secret', () => {
        expect(getSharedCloudSecretService()).toBe('cloud_api_key');
        expect(resolveProviderSecretService('gpt')).toBe('cloud_api_key');
        expect(resolveProviderSecretService('gemini')).toBe('cloud_api_key');
    });

    it('keeps custom text provider keys separate from the shared cloud secret', () => {
        expect(resolveProviderSecretService(CUSTOM_TEXT_PROVIDER_ID)).toBe('custom_text_api_key');
        expect(resolveProviderSecretService(CUSTOM_IMAGE_PROVIDER_ID)).toBe('cloud_api_key');
    });

    it('does not create frontend-managed secret slots for unknown providers', () => {
        expect(isCloudProviderId('openai')).toBe(false);
        expect(resolveProviderSecretService('openai')).toBeNull();
        expect(isCloudProviderId('groq')).toBe(false);
        expect(resolveProviderSecretService('groq')).toBeNull();
        expect(isCloudProviderId('local-runtime')).toBe(false);
        expect(resolveProviderSecretService('local-runtime')).toBeNull();
        expect(resolveProviderSecretService('unknown-provider')).toBeNull();
    });
});
