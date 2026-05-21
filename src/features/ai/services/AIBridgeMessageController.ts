import type {
    IBridgeResponse,
    ChatContent,
    ChatContentPart,
    IChatMessage,
    IImageGenerationRequest,
    MessageSource,
} from '../types/aiTypes';
import { constructChatRequest, createMultimodalContent } from '../utils/chatRequestUtils';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { AIBridgeContext } from './AIBridgeContext';
import type { IChatTransport } from './AIChatTransport';
import type { AIProviderManager } from './AIProviderManager';
import type { AIBridgeEvents } from './AIBridgeEvents';
import type { AIBridgeProviderPolicy } from './AIBridgeProviderPolicy';
import type { IAIBridgeSendMessageOptions } from '../types/IAIBridge';
import {
    CUSTOM_TEXT_PROVIDER_ID,
    resolveCustomProviderBackendId,
} from '@/shared/utils/customProviderSupport';

type AIBridgeMessageLogger = Pick<LoggerService, 'error'>;

type AIBridgeMessageControllerDeps = {
    getContext: () => AIBridgeContext | null;
    transport: IChatTransport;
    manager: AIProviderManager;
    events: AIBridgeEvents;
    providerPolicy: AIBridgeProviderPolicy;
    tracer: AIBridgeMessageLogger;
    translate: (key: string, fallback: string) => string;
    showToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
    onActivity: () => void;
    onLongActivityStart: () => void;
    onLongActivityEnd: () => void;
    onSuccessfulResponse: () => void;
};

export class AIBridgeMessageController {
    constructor(private readonly _deps: AIBridgeMessageControllerDeps) {}

    public async sendMessage(
        text: string,
        source: MessageSource,
        attachments: { name: string; type: string; data_base64: string }[],
        history: IChatMessage[],
        options: IAIBridgeSendMessageOptions = {},
    ): Promise<IBridgeResponse> {
        if (this._deps.manager.activeProviderId === null) {
            return this._handleMissingProvider(source);
        }

        await this._deps.manager.refreshActiveApiKey();

        if (this._deps.manager.apiKey === null && this._deps.manager.isActive() === false) {
            return this._handleMissingApiKey(source);
        }

        try {
            this._deps.onActivity();

            const providerId = this._deps.manager.activeProviderId;
            const isImageProvider = this._deps.providerPolicy.isImageProvider(providerId);

            if (isImageProvider) {
                return await this._sendImageMessage(providerId, text, source, options);
            }

            return await this._sendTextMessage(providerId, text, attachments, history, source);
        } catch (error: unknown) {
            const errorMsg =
                error instanceof Error
                    ? error.message
                    : this._deps.translate('ui.ai.communication_failure', 'Communication failure');
            this._deps.tracer.error('[AIBridge] Messaging pipeline error:', error);
            return { ok: false, error: errorMsg };
        }
    }

    public async prepareImagePrompt(text: string): Promise<IBridgeResponse> {
        if (this._deps.manager.activeProviderId === null) {
            return this._silentMissingProviderResponse();
        }

        await this._deps.manager.refreshActiveApiKey();
        if (this._deps.manager.apiKey === null && this._deps.manager.isActive() === false) {
            return this._silentMissingApiKeyResponse();
        }

        try {
            this._deps.onActivity();

            const providerId = this._deps.manager.activeProviderId;
            const backendProviderId =
                providerId === CUSTOM_TEXT_PROVIDER_ID
                    ? providerId
                    : resolveCustomProviderBackendId(providerId);
            const requestModel = this._resolveRequestModel(providerId);
            if (requestModel === null) {
                return this._handleMissingModel();
            }
            const cloudApiBaseUrl = this._deps.manager.getProviderBaseUrl(providerId);
            const requestOptions = this._deps.providerPolicy.buildRequestOptions({
                hasApiKey: this._deps.manager.apiKey !== null,
                maxOutputTokens: Math.min(this._deps.manager.maxOutputTokens ?? 320, 420),
                thinkingLevel: 'off',
                webSearchEnabled: false,
            });
            const request = constructChatRequest(
                [],
                {
                    role: 'user',
                    content: text,
                },
                [],
                {
                    providerId: backendProviderId,
                    model: requestModel,
                    apiKey: null,
                    cloudApiBaseUrl,
                    sessionId: '',
                    ...requestOptions,
                },
            );

            this._deps.onLongActivityStart();
            const response = await this._deps.transport
                .sendSilent(request)
                .finally(this._deps.onLongActivityEnd);
            return this._withModelContext(response, providerId, request.model);
        } catch (error: unknown) {
            const errorMsg =
                error instanceof Error
                    ? error.message
                    : this._deps.translate('ui.ai.communication_failure', 'Communication failure');
            this._deps.tracer.error('[AIBridge] Silent prompt preparation failed:', error);
            return { ok: false, error: errorMsg };
        }
    }

    private _silentMissingProviderResponse(): IBridgeResponse {
        return {
            ok: false,
            error: this._deps.translate('ui.ai.no_provider', 'No AI provider selected'),
        };
    }

    private _silentMissingApiKeyResponse(): IBridgeResponse {
        return {
            ok: false,
            error: this._deps.translate('ui.ai.missing_api_key', 'API key missing'),
        };
    }

    private async _sendImageMessage(
        providerId: string,
        text: string,
        source: MessageSource,
        options: IAIBridgeSendMessageOptions,
    ): Promise<IBridgeResponse> {
        const context = this._deps.getContext();
        const selectedImageModule = context?.stateStore.getSelectedModule('ai_image');
        const settingsKey = selectedImageModule?.id ?? providerId;
        const backendProviderId =
            providerId === CUSTOM_TEXT_PROVIDER_ID
                ? providerId
                : resolveCustomProviderBackendId(providerId);
        const originalPrompt = options.originalPrompt?.trim();

        const request: IImageGenerationRequest = {
            provider: backendProviderId,
            prompt: text,
            original_prompt:
                originalPrompt !== undefined && originalPrompt !== '' ? originalPrompt : text,
            model: this._deps.manager.model,
            settings_key: settingsKey,
            session_id: this._deps.manager.sessionId,
        };

        this._deps.events.broadcastReplaceChunk('image status=starting\n');

        this._deps.onLongActivityStart();
        const imageResponse = await this._deps.transport.generateImage(request).finally(() => {
            this._deps.onLongActivityEnd();
        });
        if (imageResponse.ok && imageResponse.images && imageResponse.images.length > 0) {
            this._deps.onSuccessfulResponse();
            return {
                ok: true,
                text: '',
                images: imageResponse.images,
            };
        }

        return this._handleTransportResponse(
            this._withModelContext(imageResponse, providerId, request.model),
            source,
        );
    }

    private async _sendTextMessage(
        providerId: string,
        text: string,
        attachments: { name: string; type: string; data_base64: string }[],
        history: IChatMessage[],
        source: MessageSource,
    ): Promise<IBridgeResponse> {
        const context = this._deps.getContext();
        const isLocalTextProvider = this._deps.providerPolicy.isLocalTextProvider(providerId);
        if (isLocalTextProvider && this._hasImageAttachments(attachments)) {
            return {
                ok: false,
                error: this._deps.translate(
                    'ui.chat.error.local_model_image_input',
                    'The selected local text model does not support image input. Remove the image or use a multimodal model with mmproj.',
                ),
                model: providerId,
            };
        }

        const newMessage: IChatMessage = {
            role: 'user',
            content: isLocalTextProvider ? text : createMultimodalContent(text, attachments),
        };

        if (this._deps.manager.isActive() === false) {
            return this._handleMissingApiKey(source);
        }

        const backendProviderId =
            providerId === CUSTOM_TEXT_PROVIDER_ID
                ? providerId
                : resolveCustomProviderBackendId(providerId);
        const requestHistory = isLocalTextProvider ? this._toTextOnlyMessages(history) : history;
        const requestAttachments = isLocalTextProvider ? [] : attachments;
        const requestModel = this._resolveRequestModel(providerId);
        if (requestModel === null) {
            return this._handleMissingModel();
        }
        const cloudApiBaseUrl = this._deps.manager.getProviderBaseUrl(providerId);
        const requestOptions = this._deps.providerPolicy.buildRequestOptions({
            hasApiKey: this._deps.manager.apiKey !== null,
            maxOutputTokens: this._deps.manager.maxOutputTokens,
            thinkingLevel: context?.aiSettings.getThinkingLevel(providerId),
            webSearchEnabled: context?.aiSettings.getInternetAccessEnabled(providerId),
        });
        const request = constructChatRequest(requestHistory, newMessage, requestAttachments, {
            providerId: backendProviderId,
            model: requestModel,
            apiKey: null,
            cloudApiBaseUrl,
            sessionId: this._deps.manager.sessionId,
            ...requestOptions,
        });

        const response = await this._deps.transport.send(request);
        return this._handleTransportResponse(
            this._withModelContext(response, providerId, request.model),
            source,
        );
    }

    private _hasImageAttachments(
        attachments: { name: string; type: string; data_base64: string }[],
    ): boolean {
        return attachments.some((attachment) => attachment.type.startsWith('image/'));
    }

    private _toTextOnlyMessages(messages: IChatMessage[]): IChatMessage[] {
        return messages.map((message) => {
            const textContent = this._toTextOnlyContent(message.content);
            const normalized: IChatMessage = {
                role: message.role,
                content: textContent,
            };
            if (message.thought_signature !== undefined) {
                normalized.thought_signature = message.thought_signature;
            }
            return normalized;
        });
    }

    private _toTextOnlyContent(content: ChatContent): string {
        if (typeof content === 'string') {
            return content;
        }

        const parts = content
            .map((part) => this._toTextOnlyPart(part))
            .filter((part): part is string => part.trim() !== '');
        return parts.join('\n').trim();
    }

    private _toTextOnlyPart(part: ChatContentPart): string {
        if (part.type === 'text') {
            return part.text;
        }
        if (part.type === 'image_url') {
            return '[Image omitted: the selected local text model does not support image input.]';
        }
        return part.name !== undefined ? `[File attached: ${part.name}]` : '[File attached]';
    }

    private _resolveRequestModel(providerId: string): string | null {
        const model = this._deps.manager.model.trim();
        if (model !== '') {
            return model;
        }

        return this._deps.providerPolicy.isLocalTextProvider(providerId) ? 'default' : null;
    }

    private _withModelContext(
        response: IBridgeResponse,
        providerId: string,
        requestModel: string,
    ): IBridgeResponse {
        if (response.ok) {
            return response;
        }

        const isCloudProvider = this._deps.providerPolicy.isCloudProvider(providerId);
        if (isCloudProvider && response.model !== undefined) {
            return response;
        }

        const fallbackModel = isCloudProvider ? requestModel : providerId;
        return {
            ...response,
            model: fallbackModel,
        };
    }

    private _handleMissingApiKey(_source: MessageSource): IBridgeResponse {
        const msg = this._deps.translate('ui.ai.no_api_key', 'API key missing');
        this._deps.showToast(msg, 'error');
        return { ok: false, error: msg };
    }

    private _handleMissingProvider(_source: MessageSource): IBridgeResponse {
        const msg = this._deps.translate('ui.ai.no_provider', 'No engine found');
        this._deps.showToast(msg, 'error');
        return { ok: false, error: msg };
    }

    private _handleMissingModel(): IBridgeResponse {
        const msg = this._deps.translate('ui.ai.no_model_selected', 'No AI model selected');
        this._deps.showToast(msg, 'error');
        return { ok: false, error: msg };
    }

    private _handleTransportResponse(
        response: IBridgeResponse,
        source: MessageSource,
    ): IBridgeResponse {
        if (response.ok && typeof response.text === 'string' && response.text !== '') {
            this._deps.onSuccessfulResponse();
            this._deps.events.broadcastResponse(response.text, source);
        } else if (!response.ok && typeof response.error === 'string' && response.error !== '') {
            this._deps.tracer.error('[AIBridge] Backend operation anomaly:', response.error);
        }

        return response;
    }
}
