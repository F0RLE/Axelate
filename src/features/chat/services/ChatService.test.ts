/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from './ChatService';
import type { IAIBridge } from '@/features/ai/types/IAIBridge';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

describe('ChatService', () => {
    let chatService: ChatService;
    let mockAIBridge: IAIBridge;
    let mockI18n: I18nService;
    let tracer: Pick<LoggerService, 'error'>;

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

        tracer = { error: vi.fn() };
        chatService = new ChatService(mockAIBridge, mockI18n, tracer);
    });

    it('should return error when AIBridge is not active (L27)', async () => {
        (mockAIBridge.isActive as any).mockReturnValue(false);

        const result = await chatService.sendMessage('Hello', [], []);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('No AI module running. Please launch a module first.');
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

    it('should use fallback error when response.error is undefined (L43)', async () => {
        (mockAIBridge.isActive as any).mockReturnValue(true);
        (mockAIBridge.sendMessage as any).mockResolvedValue({ ok: false });

        const result = await chatService.sendMessage('Hello', [], []);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Unknown bridge error');
    });

    it('should use empty string when response.text is undefined (L49)', async () => {
        (mockAIBridge.isActive as any).mockReturnValue(true);
        (mockAIBridge.sendMessage as any).mockResolvedValue({ ok: true });

        const result = await chatService.sendMessage('Hello', [], []);
        expect(result.ok).toBe(true);
        expect(result.message).toBe('');
    });

    it('should handle non-Error throw in sendMessage (L52)', async () => {
        (mockAIBridge.isActive as any).mockReturnValue(true);
        (mockAIBridge.sendMessage as any).mockRejectedValue('string-error');

        const result = await chatService.sendMessage('Hi', [], []);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Unknown error');
    });
});
