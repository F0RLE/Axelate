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
    });

    describe('constructChatRequest', () => {
        const mockMessage: IChatMessage = {
            role: 'user',
            content: 'Hello',
        };

        it('should construct a valid request object', () => {
            const config = {
                providerId: 'gpt',
                model: 'gpt-5.2',
                apiKey: 'sk-123',
                sessionId: 'session-1',
                thinkingLevel: 'high' as const,
            };

            const request = constructChatRequest(mockMessage, [], config);

            expect(request).toEqual({
                provider: 'openai', // mapped from 'gpt'
                model: 'gpt-5.2',
                messages: [{ role: 'user', content: 'Hello', thought_signature: undefined }],
                session_id: 'session-1',
                api_key: 'sk-123',
                thinking_level: 'high',
                attachments: [],
            });
        });

        it('should handle missing API key (null)', () => {
            const config = {
                providerId: 'local',
                model: 'llama-4-maverick',
                apiKey: null,
                sessionId: 'session-local',
                thinkingLevel: 'minimal' as const,
            };

            const request = constructChatRequest(mockMessage, [], config);

            expect(request.api_key).toBeNull();
            expect(request.provider).toBe('local'); // mapped from 'local'
        });
    });
});
