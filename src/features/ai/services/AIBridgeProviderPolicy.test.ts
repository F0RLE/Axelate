import { describe, expect, it } from 'vitest';
import { AIBridgeProviderPolicy } from './AIBridgeProviderPolicy';

describe('AIBridgeProviderPolicy', () => {
    const policy = new AIBridgeProviderPolicy();

    it('should classify cloud and image providers consistently', () => {
        expect(policy.isCloudProvider('gemini')).toBe(true);
        expect(policy.isCloudProvider('llamacpp')).toBe(false);
        expect(policy.isImageProvider('comfyui')).toBe(true);
        expect(policy.isImageProvider('gemini')).toBe(false);
        expect(policy.isManagedLocalImageEngine('sdcpp')).toBe(true);
        expect(policy.isManagedLocalImageEngine('comfyui')).toBe(false);
    });

    it('should build cloud request options without off thinking level', () => {
        expect(
            policy.buildRequestOptions({
                hasApiKey: true,
                maxOutputTokens: 2048,
                thinkingLevel: 'off',
                webSearchEnabled: true,
            }),
        ).toEqual({
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

    it('should resolve performance mode from module-specific or global settings', () => {
        expect(
            policy.isImagePerformanceModeEnabled(
                {
                    comfyui_performance_mode: 'true',
                },
                'comfyui',
            ),
        ).toBe(true);
        expect(
            policy.isImagePerformanceModeEnabled(
                {
                    sdcpp_performance_mode: true,
                },
                'stable-diffusion',
            ),
        ).toBe(true);
        expect(policy.isImagePerformanceModeEnabled({}, 'comfyui')).toBe(false);
    });
});
