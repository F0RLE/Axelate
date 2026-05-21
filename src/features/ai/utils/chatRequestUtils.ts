import type { ChatContent, IChatMessage, IChatRequest, ChatContentPart } from '../types/aiTypes';

type RequestThinkingLevel = 'none' | 'off' | 'low' | 'medium' | 'high';

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
    history: IChatMessage[],
    message: IChatMessage,
    attachments: { name: string; type: string; data_base64: string }[],
    config: {
        providerId: string;
        model: string;
        apiKey: string | null;
        cloudApiBaseUrl?: string | undefined;
        sessionId?: string;
        thinkingLevel?: RequestThinkingLevel;
        maxTokens?: number | undefined;
        webSearchEnabled?: boolean;
    },
): IChatRequest {
    const {
        providerId,
        model,
        apiKey,
        cloudApiBaseUrl,
        sessionId,
        thinkingLevel,
        maxTokens,
        webSearchEnabled,
    } = config;
    const request: IChatRequest = {
        provider: providerId,
        model,
        messages: [
            ...history.map((historyMessage) => ({
                role: historyMessage.role,
                content: historyMessage.content,
                thought_signature: historyMessage.thought_signature,
            })),
            {
                role: message.role,
                content: message.content,
                thought_signature: message.thought_signature,
            },
        ],
        api_key: apiKey,
        attachments,
    };

    const normalizedCloudApiBaseUrl = cloudApiBaseUrl?.trim();
    if (normalizedCloudApiBaseUrl !== undefined && normalizedCloudApiBaseUrl !== '') {
        request.cloud_api_base_url = normalizedCloudApiBaseUrl;
    }

    const normalizedSessionId = sessionId?.trim();
    if (normalizedSessionId !== undefined && normalizedSessionId !== '') {
        request.session_id = normalizedSessionId;
    }

    if (thinkingLevel !== undefined) {
        request.thinking_level = thinkingLevel;
    }

    if (maxTokens !== undefined) {
        request.max_tokens = maxTokens;
    }

    if (webSearchEnabled === true) {
        request.web_search = {
            enabled: true,
        };
    }

    return request;
}
