import { describe, it, expect, beforeEach } from 'vitest';
import { AISettingsService } from './AISettingsService';
import type { UiStateStore } from '../state/UiStateStore';

import { createMockStore } from '@/test/mocks/mockUiStateStore';
describe('AISettingsService', () => {
    let store: UiStateStore;
    let service: AISettingsService;

    beforeEach(() => {
        store = createMockStore();
        service = new AISettingsService(store);
    });

    it('should get and set selected AI model', () => {
        expect(service.getSelectedAIModel('gemini')).toBeUndefined();
        service.setSelectedAIModel('gemini', 'gemini-pro');
        expect(service.getSelectedAIModel('gemini')).toBe('gemini-pro');
    });

    it('should get and set OpenAI-compatible API base URLs', () => {
        expect(service.getApiBaseUrl('gpt')).toBe('https://openrouter.ai/api/v1');

        expect(service.setApiBaseUrl('gpt', ' https://api.openai.com/v1/ ')).toBe(true);
        expect(service.getApiBaseUrl('gpt')).toBe('https://api.openai.com/v1');
    });

    it('should reject unsafe API base URLs', () => {
        expect(service.setApiBaseUrl('gpt', 'http://evil.test/v1')).toBe(false);
        expect(service.getApiBaseUrl('gpt')).toBe('https://openrouter.ai/api/v1');
    });

    it('should get thinking level (default off for cloud providers)', () => {
        expect(service.getThinkingLevel('gemini')).toBe('off');
    });

    it('should not infer thinking defaults from provider ids', () => {
        expect(service.getThinkingLevel('llamacpp')).toBe('off');
    });

    it('should set thinking level', () => {
        service.setThinkingLevel('gemini', 'low');
        expect(service.getThinkingLevel('gemini')).toBe('low');
    });

    it('should disable internet access by default for cloud providers', () => {
        expect(service.getInternetAccessEnabled('gpt')).toBe(false);
        expect(service.getInternetAccessEnabled('custom-text')).toBe(false);
    });

    it('should disable internet access by default for local providers', () => {
        expect(service.getInternetAccessEnabled('llamacpp')).toBe(false);
    });

    it('should set internet access explicitly', () => {
        service.setInternetAccessEnabled('gpt', false);
        expect(service.getInternetAccessEnabled('gpt')).toBe(false);
    });

    it('should get default local max output tokens', () => {
        expect(service.getLocalMaxOutputTokens('llamacpp')).toBe(384);
    });

    it('should set and clamp local max output tokens', () => {
        service.setLocalMaxOutputTokens('llamacpp', 512);
        expect(service.getLocalMaxOutputTokens('llamacpp')).toBe(512);

        service.setLocalMaxOutputTokens('llamacpp', 999999);
        expect(service.getLocalMaxOutputTokens('llamacpp')).toBe(32768);
    });
});
