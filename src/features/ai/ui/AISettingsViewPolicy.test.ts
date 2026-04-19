import { describe, expect, it } from 'vitest';
import { AISettingsViewPolicy } from './AISettingsViewPolicy';

describe('AISettingsViewPolicy', () => {
    const policy = new AISettingsViewPolicy();

    it('should classify clean apps and feature support consistently', () => {
        expect(policy.isCleanApp('axelate')).toBe(true);
        expect(policy.isCleanApp('telegram-bot')).toBe(true);
        expect(policy.isCleanApp('gpt')).toBe(false);
        expect(policy.supportsInternetAccess('gpt')).toBe(true);
        expect(policy.supportsInternetAccess('axelate')).toBe(false);
        expect(policy.supportsThinking('gpt')).toBe(true);
        expect(policy.supportsThinking('openrouter')).toBe(false);
    });

    it('should format context windows compactly', () => {
        expect(policy.formatCompactContext(800)).toBe('800');
        expect(policy.formatCompactContext(8_000)).toBe('8K');
        expect(policy.formatCompactContext(128_000)).toBe('128K');
        expect(policy.formatCompactContext(1_500_000)).toBe('1.5M');
        expect(policy.formatCompactContext(12_000_000)).toBe('12M');
    });
});
