import { describe, it, expect } from 'vitest';
import { constructChatRequest, createMultimodalContent } from './chatRequestUtils';
import type { IChatMessage } from '../types/aiTypes';

describe('chatRequestUtils', () => {
    describe('createMultimodalContent', () => {
        it('should return simple text string if no attachments', () => {
            const result = createMultimodalContent('Hello world', []);
            expect(result).toBe('Hello world');
        });

        it('should return array of content parts if attachments exist', () => {
            const result = createMultimodalContent('Look at this', [
                { name: 'image.png', type: 'image/png', data_base64: 'base64data' },
            ]);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ type: 'text', text: 'Look at this' });
            expect(result[1]).toEqual({
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,base64data' },
            });
        });

        it('should skip non-image attachments (only text part)', () => {
            const result = createMultimodalContent('Check this', [
                { name: 'doc.pdf', type: 'application/pdf', data_base64: 'pdfdata' },
            ]);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ type: 'text', text: 'Check this' });
        });
    });

    describe('constructChatRequest', () => {
        const mockMessage: IChatMessage = {
            role: 'user',
            content: 'Hello',
        };

        it('should construct a valid request object', () => {
            const config = {
                providerId: 'gpt',
                model: 'gpt-5.5',
                apiKey: 'sk-123',
                sessionId: 'session-1',
                thinkingLevel: 'high' as const,
            };

            const request = constructChatRequest([], mockMessage, [], config);

            expect(request).toEqual({
                provider: 'gpt',
                model: 'gpt-5.5',
                messages: [{ role: 'user', content: 'Hello', thought_signature: undefined }],
                session_id: 'session-1',
                api_key: 'sk-123',
                thinking_level: 'high',
                max_tokens: undefined,
                attachments: [],
                web_search: undefined,
            });
        });

        it('should handle missing API key (null)', () => {
            const config = {
                providerId: 'local',
                model: 'llama-4-maverick',
                apiKey: null,
                sessionId: 'session-local',
                thinkingLevel: 'low' as const,
            };

            const request = constructChatRequest([], mockMessage, [], config);

            expect(request.api_key).toBeNull();
            expect(request.provider).toBe('local'); // mapped from 'local'
        });

        it('should prepend existing history before the current message', () => {
            const config = {
                providerId: 'gpt',
                model: 'gpt-5.5',
                apiKey: 'sk-123',
                sessionId: 'session-1',
                thinkingLevel: 'high' as const,
            };

            const request = constructChatRequest(
                [{ role: 'assistant', content: 'Previous reply' }],
                mockMessage,
                [],
                config,
            );

            expect(request.messages).toEqual([
                {
                    role: 'assistant',
                    content: 'Previous reply',
                    thought_signature: undefined,
                },
                {
                    role: 'user',
                    content: 'Hello',
                    thought_signature: undefined,
                },
            ]);
        });

        it('should omit thinking level when not provided', () => {
            const config = {
                providerId: 'llamacpp',
                model: 'Qwen3.5-9B-Q4_K_M.gguf',
                apiKey: null,
                sessionId: 'session-1',
            };

            const request = constructChatRequest([], mockMessage, [], config);

            expect(request.thinking_level).toBeUndefined();
        });

        it('should preserve explicit none reasoning effort for OpenRouter requests', () => {
            const config = {
                providerId: 'gpt',
                model: 'gpt-5.5',
                apiKey: 'sk-123',
                sessionId: 'session-1',
                thinkingLevel: 'none' as const,
            };

            const request = constructChatRequest([], mockMessage, [], config);

            expect(request.thinking_level).toBe('none');
        });

        it('should keep the raw model key and leave model resolution to backend', () => {
            const config = {
                providerId: 'gemini',
                model: 'gemini-2.5-pro',
                apiKey: 'sk-123',
                sessionId: 'session-1',
            };

            const request = constructChatRequest([], mockMessage, [], config);

            expect(request.model).toBe('gemini-2.5-pro');
        });

        it('should include web search flag when enabled', () => {
            const config = {
                providerId: 'gpt',
                model: 'gpt-5.5',
                apiKey: 'sk-123',
                sessionId: 'session-1',
                webSearchEnabled: true,
            };

            const request = constructChatRequest([], mockMessage, [], config);

            expect(request.web_search).toEqual({
                enabled: true,
            });
        });
    });
});
