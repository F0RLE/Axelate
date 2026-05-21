import { describe, expect, it } from 'vitest';
import { AISettingsViewPolicy } from './AISettingsViewPolicy';
import {
    CUSTOM_IMAGE_PROVIDER_ID,
    CUSTOM_TEXT_PROVIDER_ID,
} from '@/shared/utils/customProviderSupport';

describe('AISettingsViewPolicy', () => {
    const policy = new AISettingsViewPolicy();

    it('should classify clean apps and feature support consistently', () => {
        expect(policy.isCleanApp('axelate')).toBe(true);
        expect(policy.isCleanApp('sample-integration')).toBe(false);
        expect(policy.isCleanApp('gpt')).toBe(false);
        expect(policy.supportsInternetAccess('gpt')).toBe(true);
        expect(policy.supportsInternetAccess('axelate')).toBe(false);
        expect(policy.supportsInternetAccess('gemini-image')).toBe(false);
        expect(policy.supportsInternetAccess('seedream-image')).toBe(false);
        expect(policy.supportsInternetAccess(CUSTOM_TEXT_PROVIDER_ID)).toBe(true);
        expect(policy.supportsThinking('gpt')).toBe(true);
        expect(policy.supportsThinking('openrouter')).toBe(false);
        expect(policy.supportsThinking(CUSTOM_TEXT_PROVIDER_ID)).toBe(true);
        expect(policy.isImageOnlyProvider('gemini-image')).toBe(true);
        expect(policy.isImageOnlyProvider('seedream-image')).toBe(true);
        expect(policy.isImageOnlyProvider(CUSTOM_IMAGE_PROVIDER_ID)).toBe(true);
        expect(policy.shouldShowModelStats(CUSTOM_TEXT_PROVIDER_ID)).toBe(false);
        expect(policy.shouldForceThinkingVisibility(CUSTOM_TEXT_PROVIDER_ID)).toBe(true);
    });

    it('should format context windows compactly', () => {
        expect(policy.formatCompactContext(800)).toBe('800');
        expect(policy.formatCompactContext(8_000)).toBe('8K');
        expect(policy.formatCompactContext(128_000)).toBe('128K');
        expect(policy.formatCompactContext(1_500_000)).toBe('1.5M');
        expect(policy.formatCompactContext(12_000_000)).toBe('12M');
    });
});
