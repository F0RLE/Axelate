import { describe, expect, it } from 'vitest';
import { AIBridgeProviderPolicy } from './AIBridgeProviderPolicy';
import {
    CUSTOM_IMAGE_PROVIDER_ID,
    CUSTOM_TEXT_PROVIDER_ID,
} from '@/shared/utils/customProviderSupport';

describe('AIBridgeProviderPolicy', () => {
    const policy = new AIBridgeProviderPolicy();

    it('should classify cloud and image providers consistently', () => {
        expect(policy.isCloudProvider('gemini')).toBe(true);
        expect(policy.isCloudProvider('seedream-image')).toBe(true);
        expect(policy.isCloudProvider(CUSTOM_TEXT_PROVIDER_ID)).toBe(true);
        expect(policy.isCloudProvider(CUSTOM_IMAGE_PROVIDER_ID)).toBe(true);
        expect(policy.isCloudProvider('llamacpp')).toBe(false);
        expect(policy.isImageProvider('comfyui')).toBe(true);
        expect(policy.isImageProvider('seedream-image')).toBe(true);
        expect(policy.isImageProvider(CUSTOM_IMAGE_PROVIDER_ID)).toBe(true);
        expect(policy.isImageProvider('gemini')).toBe(false);
        expect(policy.isImageProvider(CUSTOM_TEXT_PROVIDER_ID)).toBe(false);
        expect(policy.isManagedLocalImageEngine('sdcpp')).toBe(true);
        expect(policy.isManagedLocalImageEngine('comfyui')).toBe(false);
        expect(policy.isLocalTextProvider('llamacpp')).toBe(true);
        expect(policy.isLocalTextProvider('sdcpp')).toBe(false);
        expect(policy.isLocalTextProvider(CUSTOM_TEXT_PROVIDER_ID)).toBe(false);
    });

    it('should map off thinking level to explicit OpenRouter none effort', () => {
        expect(
            policy.buildRequestOptions({
                hasApiKey: true,
                maxOutputTokens: 2048,
                thinkingLevel: 'off',
                webSearchEnabled: true,
            }),
        ).toEqual({
            thinkingLevel: 'none',
            maxTokens: 2048,
            webSearchEnabled: true,
        });
    });

    it('should skip request options for local providers', () => {
        expect(
            policy.buildRequestOptions({
                hasApiKey: false,
                maxOutputTokens: 2048,
                thinkingLevel: 'high',
                webSearchEnabled: true,
            }),
        ).toEqual({});
    });
});
