import type { ChatContent, IChatMessage, IChatRequest, ChatContentPart } from '../types/aiTypes';
import { getApiModelId, mapProviderToBackend } from '../utils/catalogHelpers';

/**
 * Creates a multimodal content object from text and attachments.
 */
export function createMultimodalContent(
    text: string,
    attachments: { name: string; type: string; data_base64: string }[],
): ChatContent {
    if (attachments.length === 0) return text;

    const parts: ChatContentPart[] = [{ type: 'text', text }];
    attachments.forEach((attachment) => {
        if (attachment.type.startsWith('image/')) {
            parts.push({
                type: 'image_url',
                image_url: {
                    url: `data:${attachment.type};base64,${attachment.data_base64}`,
                },
            });
        }
    });
    return parts;
}

/**
 * Constructs a standardized chat request object.
 */
export function constructChatRequest(
    message: IChatMessage,
    attachments: { name: string; type: string; data_base64: string }[],
    config: {
        providerId: string;
        model: string;
        apiKey: string | null;
        sessionId: string;
        thinkingLevel: 'low' | 'high' | 'minimal';
    },
): IChatRequest {
    const { providerId, model, apiKey, sessionId, thinkingLevel } = config;
    const modelId = getApiModelId(providerId, model);

    return {
        provider: mapProviderToBackend(providerId),
        model: modelId,
        messages: [
            {
                role: message.role,
                content: message.content,
                thought_signature: message.thought_signature,
            },
        ],
        session_id: sessionId,
        api_key: apiKey,
        thinking_level: thinkingLevel,
        attachments,
    };
}
