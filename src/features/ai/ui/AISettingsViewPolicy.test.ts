import { describe, expect, it } from 'vitest';
import { AISettingsViewPolicy } from './AISettingsViewPolicy';
import {
    CUSTOM_IMAGE_PROVIDER_ID,
    CUSTOM_TEXT_PROVIDER_ID,
} from '@/shared/utils/customProviderSupport';

describe('AISettingsViewPolicy', () => {
    const policy = new AISettingsViewPolicy();

    it('should classify clean apps and feature support consistently', () => {
        const gptApp = {
            id: 'gpt',
            providerPolicy: {
                isCloudProvider: true,
                isCustomProvider: false,
                isCleanApp: false,
                secretService: 'cloud_api_key',
                keyProviderId: 'cloud',
                keyProviderUrl: 'https://openrouter.ai/settings/keys',
                usesCustomProviderKey: false,
                showApiEndpointSelector: false,
                showCustomModelComposer: false,
                showModelStats: true,
                supportsInternetAccess: true,
                supportsThinking: true,
                imageOnly: false,
            },
        };
        const customTextApp = {
            id: CUSTOM_TEXT_PROVIDER_ID,
            providerPolicy: {
                ...gptApp.providerPolicy,
                isCustomProvider: true,
                secretService: 'custom_text_api_key',
                keyProviderId: CUSTOM_TEXT_PROVIDER_ID,
                keyProviderUrl: null,
                usesCustomProviderKey: true,
                showApiEndpointSelector: true,
                showCustomModelComposer: true,
                showModelStats: false,
                supportsInternetAccess: false,
                supportsThinking: false,
            },
        };
        const imageApp = {
            id: 'gemini-image',
            capability: 'image' as const,
            providerPolicy: {
                ...gptApp.providerPolicy,
                supportsInternetAccess: false,
                supportsThinking: false,
                imageOnly: true,
            },
        };

        expect(policy.isCleanApp('axelate')).toBe(false);
        expect(
            policy.isCleanApp({
                id: 'axelate',
                providerPolicy: { ...gptApp.providerPolicy, isCleanApp: true },
            }),
        ).toBe(true);
        expect(policy.isCleanApp('sample-integration')).toBe(false);
        expect(policy.isCleanApp('gpt')).toBe(false);
        expect(policy.supportsInternetAccess(gptApp)).toBe(true);
        expect(policy.supportsInternetAccess({ id: 'axelate' })).toBe(false);
        expect(policy.supportsInternetAccess(imageApp)).toBe(false);
        expect(policy.supportsInternetAccess(customTextApp)).toBe(false);
        expect(policy.supportsThinking(gptApp)).toBe(true);
        expect(policy.supportsThinking({ id: 'openrouter' })).toBe(false);
        expect(policy.supportsThinking(customTextApp)).toBe(false);
        expect(policy.isImageOnlyProvider(imageApp)).toBe(true);
        expect(
            policy.isImageOnlyProvider({
                id: CUSTOM_IMAGE_PROVIDER_ID,
                capability: 'image',
            }),
        ).toBe(true);
        expect(policy.shouldShowModelStats(customTextApp)).toBe(false);
        expect(policy.shouldForceThinkingVisibility(customTextApp)).toBe(false);
    });

    it('should format context windows compactly', () => {
        expect(policy.formatCompactContext(800)).toBe('800');
        expect(policy.formatCompactContext(8_000)).toBe('8K');
        expect(policy.formatCompactContext(128_000)).toBe('128K');
        expect(policy.formatCompactContext(1_500_000)).toBe('1.5M');
        expect(policy.formatCompactContext(12_000_000)).toBe('12M');
    });
});
