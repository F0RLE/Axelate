import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { ChatContent, ChatContentPart } from '@/features/ai/types/aiTypes';

type ChatContentHelperLogger = Pick<LoggerService, 'error'>;

type ErrorRule = {
    patterns: string[];
    key: string;
    fallback: string;
};

export class ChatContentHelper {
    private static readonly _defaultProviderName = 'AI Provider';
    private static readonly _errorRules: ErrorRule[] = [
        {
            patterns: ['402', 'payment required', 'credits', 'balance', 'insufficient credit'],
            key: 'ui.chat.error.payment_required',
            fallback: 'Error 402: Payment Required. Please check your provider balance.',
        },
        {
            patterns: ['429', 'rate limit', 'too many requests'],
            key: 'ui.chat.error.quota',
            fallback:
                'Error: The provider or the selected model hit a rate limit. Wait a bit and try again.',
        },
        {
            patterns: ['503', 'unavailable', 'overloaded'],
            key: 'ui.chat.error.server',
            fallback:
                'Error: The selected AI service is temporarily unavailable. Please try again later.',
        },
        {
            patterns: ['403', 'permission_denied', 'api key'],
            key: 'ui.chat.error.auth',
            fallback: 'Error: Invalid API key. Please check the key in settings.',
        },
    ];
    private static readonly _localModelMemoryRule: ErrorRule = {
        patterns: [
            'not enough memory to start the local model',
            'reduce context size',
            'gpu layers',
        ],
        key: 'ui.chat.error.local_model_memory',
        fallback:
            'Not enough memory to start the local model. Reduce context size or GPU layers, or use a smaller model.',
    };
    private static readonly _localModelSystemMemoryRule: ErrorRule = {
        patterns: ['not enough system memory to start the local model', 'close other apps'],
        key: 'ui.chat.error.local_model_system_memory',
        fallback:
            'Not enough system memory to start the local model. Close other apps or use a smaller model.',
    };
    private static readonly _localModelUnavailableRule: ErrorRule = {
        patterns: ['503', 'unavailable', 'overloaded', 'not running'],
        key: 'ui.chat.error.local_model_unavailable',
        fallback:
            'Local model engine is unavailable. Start or restart the selected local model and try again.',
    };
    private static readonly _localModelImageInputRule: ErrorRule = {
        patterns: ['image input is not supported', 'mmproj'],
        key: 'ui.chat.error.local_model_image_input',
        fallback:
            'The selected local text model does not support image input. Remove the image or use a multimodal model with mmproj.',
    };
    private static readonly _imageVramRule: ErrorRule = {
        patterns: [
            'cudamalloc failed',
            'ggml_backend_cuda_buffer_type_alloc_buffer',
            'alloc_tensor_range: failed to allocate cuda0 buffer',
            'unet alloc runtime params backend buffer failed',
        ],
        key: 'ui.chat.error.image_vram',
        fallback:
            'Not enough GPU memory to generate the image. Lower image size, steps, or batch size, or use a smaller model.',
    };
    private static readonly _localImageEngineConnectionRule: ErrorRule = {
        patterns: ['local image engine request failed', 'closed the connection'],
        key: 'ui.chat.error.local_image_engine_connection',
        fallback:
            'Local image engine stopped or closed the connection while generating. Restart the image engine and lower image size, steps, or batch size if it happens again.',
    };

    public constructor(
        private readonly _i18n: I18nService,
        private readonly _estimateTokens: (text: string, model?: string) => Promise<number>,
        private readonly _tracer: ChatContentHelperLogger,
    ) {}

    public extractText(data: unknown): string {
        if (Array.isArray(data)) {
            return this._extractTextFromParts(data);
        }
        if (typeof data === 'string') return data;
        if (data instanceof Error) return data.message;

        if (typeof data === 'object' && data !== null) {
            return this._extractFromObject(data as Record<string, unknown>);
        }

        return typeof data === 'number' || typeof data === 'boolean' ? String(data) : '';
    }

    public extractRenderableText(content: ChatContent): string {
        const extracted = this.extractText(content);
        if (extracted !== '') {
            return extracted;
        }

        if (this.buildHistoryRenderOptions(content).images !== undefined) {
            return this._i18n.t('ui.chat.image_ready', 'Generated image');
        }

        return '';
    }

    public buildGeneratedImageContent(
        images: Array<{ mime: string; data_base64: string }>,
        text: string,
    ): ChatContent {
        const parts: ChatContentPart[] = images.map((image) => ({
            type: 'image_url',
            image_url: {
                url: `data:${image.mime};base64,${image.data_base64}`,
            },
        }));

        if (text.trim() !== '') {
            parts.push({
                type: 'text',
                text,
            });
        }

        return parts;
    }

    public buildHistoryRenderOptions(content: ChatContent): {
        images?: Array<{ mime: string; data_base64: string }>;
    } {
        if (!Array.isArray(content)) {
            return {};
        }

        const images = content
            .map((part) => this._extractImagePart(part))
            .filter((image): image is { mime: string; data_base64: string } => image !== null);

        return images.length > 0 ? { images } : {};
    }

    public getFriendlyErrorMessage(errorMsg: unknown, model?: string): string {
        const msgStr = this.extractText(errorMsg) || 'Unknown Error';
        const msg = msgStr.toLowerCase();
        const modelName = model ?? ChatContentHelper._defaultProviderName;

        if (this._matchesAll(msg, ['reduce context size', 'gpu layers'])) {
            return this._localizeError(ChatContentHelper._localModelMemoryRule);
        }

        if (this._matchesRule(msg, ChatContentHelper._localModelMemoryRule)) {
            return this._localizeError(ChatContentHelper._localModelMemoryRule);
        }

        if (this._matchesRule(msg, ChatContentHelper._localModelSystemMemoryRule)) {
            return this._localizeError(ChatContentHelper._localModelSystemMemoryRule);
        }

        if (
            this._matchesRule(msg, ChatContentHelper._localModelUnavailableRule) &&
            this._isLocalModelContext(msg, modelName)
        ) {
            return this._localizeError(ChatContentHelper._localModelUnavailableRule);
        }

        if (
            this._matchesRule(msg, ChatContentHelper._localModelImageInputRule) &&
            this._isLocalModelContext(msg, modelName)
        ) {
            return this._localizeError(ChatContentHelper._localModelImageInputRule);
        }

        if (
            this._matchesRule(msg, ChatContentHelper._imageVramRule) ||
            this._matchesAll(msg, ['out of memory', 'stable-diffusion.cpp']) ||
            this._matchesAll(msg, ['out of memory', 'ggml'])
        ) {
            return this._localizeError(ChatContentHelper._imageVramRule);
        }

        if (this._matchesRule(msg, ChatContentHelper._localImageEngineConnectionRule)) {
            return this._localizeError(ChatContentHelper._localImageEngineConnectionRule);
        }

        const matchedRule = ChatContentHelper._errorRules.find((rule) =>
            this._matchesRule(msg, rule),
        );
        if (matchedRule !== undefined) {
            return this._localizeError(matchedRule, modelName);
        }

        const authRule =
            ChatContentHelper._errorRules.find((rule) => rule.key === 'ui.chat.error.auth') ??
            ChatContentHelper._errorRules.at(-1);
        if (msg.includes('auth') && authRule !== undefined) {
            return this._localizeError(authRule, modelName);
        }

        const serverRule =
            ChatContentHelper._errorRules.find((rule) => rule.key === 'ui.chat.error.server') ??
            ChatContentHelper._errorRules[0];
        if ((msg.includes('server error') || msg.includes('500')) && serverRule !== undefined) {
            return this._localizeError(serverRule, modelName);
        }

        return msgStr;
    }

    public async estimateReplyTokens(text: string): Promise<number> {
        try {
            return await this._estimateTokens(text);
        } catch (error: unknown) {
            this._tracer.error('[Chat] Failed to estimate reply tokens, using fallback:', error);
            return Math.max(1, Math.ceil(text.trim().length / 4));
        }
    }

    public async estimateContentTokens(content: ChatContent): Promise<number> {
        const text = this.extractText(content);
        const textTokens = text.trim() === '' ? 0 : await this.estimateReplyTokens(text);
        const imageTokens = Array.isArray(content)
            ? content.filter((part) => this._extractImagePart(part) !== null).length * 258
            : 0;

        return textTokens + imageTokens;
    }

    private _extractFromObject(obj: Record<string, unknown>): string {
        if ('message' in obj && typeof obj['message'] === 'string') return obj['message'];
        if ('error' in obj && typeof obj['error'] === 'string') return obj['error'];
        if ('text' in obj && typeof obj['text'] === 'string') return obj['text'];

        try {
            return JSON.stringify(obj, null, 2);
        } catch {
            return this._i18n.t(
                'ui.chat.complex_object_fallback',
                '[Complex object: cannot display]',
            );
        }
    }

    private _extractTextFromParts(parts: unknown[]): string {
        const textParts = parts
            .map((part) => this._extractTextPart(part))
            .filter((part): part is string => part !== '');

        return textParts.join('\n').trim();
    }

    private _extractTextPart(part: unknown): string {
        if (typeof part !== 'object' || part === null) {
            return '';
        }

        const contentPart = part as Partial<ChatContentPart>;
        if (contentPart.type === 'text' && typeof contentPart.text === 'string') {
            return contentPart.text;
        }

        return '';
    }

    private _extractImagePart(part: unknown): { mime: string; data_base64: string } | null {
        if (typeof part !== 'object' || part === null) {
            return null;
        }

        const contentPart = part as Partial<ChatContentPart>;
        if (contentPart.type !== 'image_url') {
            return null;
        }

        const url = contentPart.image_url?.url;
        if (typeof url !== 'string' || !url.startsWith('data:')) {
            return null;
        }

        const match = /^data:([^;]+);base64,(.+)$/u.exec(url);
        if (match === null) {
            return null;
        }

        return {
            mime: match[1] ?? 'application/octet-stream',
            data_base64: match[2] ?? '',
        };
    }

    private _matchesRule(message: string, rule: ErrorRule): boolean {
        return rule.patterns.some((pattern) => message.includes(pattern));
    }

    private _matchesAll(message: string, patterns: string[]): boolean {
        return patterns.every((pattern) => message.includes(pattern));
    }

    private _isLocalModelContext(message: string, modelName: string): boolean {
        const context = `${message} ${modelName}`.toLowerCase();
        return [
            'llamacpp',
            'llama.cpp',
            'gguf',
            'local model',
            'local ai engine',
            'local engine',
            '127.0.0.1',
            'localhost',
        ].some((marker) => context.includes(marker));
    }

    private _localizeError(rule: ErrorRule, modelName?: string): string {
        const localized = this._i18n.t(rule.key, rule.fallback);
        if (modelName === undefined) {
            return localized;
        }

        return localized.replace('{model}', modelName);
    }
}
