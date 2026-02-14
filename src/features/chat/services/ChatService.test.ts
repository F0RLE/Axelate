
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from './ChatService';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { I18nService } from '@/infrastructure/i18n/I18nService';

describe('ChatService', () => {
    let chatService: ChatService;
    let mockAIBridge: AIBridge;
    let mockI18n: I18nService;

    beforeEach(() => {
        mockAIBridge = {
            isActive: vi.fn(),
            sendMessage: vi.fn(),
        } as unknown as AIBridge;

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
        vi.mocked(mockAIBridge.isActive).mockReturnValue(true);
        vi.mocked(mockAIBridge.sendMessage).mockResolvedValue('Error: Some error');

        const result = await chatService.sendMessage('Hello', [], []);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Some error');
    });

    it('should return success response on valid send', async () => {
        vi.mocked(mockAIBridge.isActive).mockReturnValue(true);
        vi.mocked(mockAIBridge.sendMessage).mockResolvedValue('Hello there');

        const result = await chatService.sendMessage('Hi', [], []);
        expect(result.ok).toBe(true);
        expect(result.message).toBe('Hello there');
    });

    it('should return error if AIBridge throws', async () => {
        vi.mocked(mockAIBridge.isActive).mockReturnValue(true);
        vi.mocked(mockAIBridge.sendMessage).mockRejectedValue(new Error('Network fail'));

        const result = await chatService.sendMessage('Hi', [], []);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Network fail');
    });
});
