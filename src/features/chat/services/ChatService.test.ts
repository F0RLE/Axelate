/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from './ChatService';
import type { IAIBridge } from '@/features/ai/types/IAIBridge';
import type { I18nService } from '@/infrastructure/i18n/I18nService';

describe('ChatService', () => {
    let chatService: ChatService;
    let mockAIBridge: IAIBridge;
    let mockI18n: I18nService;

    beforeEach(() => {
        mockAIBridge = {
            isActive: vi.fn(),
            sendMessage: vi.fn(),
            // Mock other methods required by IAIBridge but not used in tests
            getActiveProvider: vi.fn(),
            startProvider: vi.fn(),
            stopProvider: vi.fn(),
            getHistory: vi.fn(),
            getState: vi.fn(),
            onMessage: vi.fn(),
            removeListener: vi.fn(),
            onChunk: vi.fn(),
            removeChunkListener: vi.fn(),
        } as unknown as IAIBridge;

        mockI18n = {
            t: vi.fn((key: string, def: string) => def || key),
        } as unknown as I18nService;

        chatService = new ChatService(mockAIBridge, mockI18n);
    });

    it('should return error if message and attachments are empty', async () => {
        const result = await chatService.sendMessage('', [], []);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Message is empty');
    });

    it('should return error if AIBridge sends error string', async () => {
        (mockAIBridge.isActive as any).mockReturnValue(true);
        (mockAIBridge.sendMessage as any).mockResolvedValue({ ok: false, error: 'Some error' });

        const result = await chatService.sendMessage('Hello', [], []);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Some error');
    });

    it('should return success response on valid send', async () => {
        (mockAIBridge.isActive as any).mockReturnValue(true);
        (mockAIBridge.sendMessage as any).mockResolvedValue({ ok: true, text: 'Hello there' });

        const result = await chatService.sendMessage('Hi', [], []);
        expect(result.ok).toBe(true);
        expect(result.message).toBe('Hello there');
    });

    it('should return error if AIBridge throws', async () => {
        (mockAIBridge.isActive as any).mockReturnValue(true);
        (mockAIBridge.sendMessage as any).mockRejectedValue(new Error('Network fail'));

        const result = await chatService.sendMessage('Hi', [], []);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Network fail');
    });
});
