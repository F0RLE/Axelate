import { beforeEach, describe, expect, it, vi } from 'vitest';

const appendMessage = vi.fn();
const clearUi = vi.fn();
const updateTokenCount = vi.fn();
const mockChatFileHandlerInstances: Array<{
    clear: ReturnType<typeof vi.fn>;
    setUpdateCallback: ReturnType<typeof vi.fn>;
    clearUpdateCallback: ReturnType<typeof vi.fn>;
    setBridge: ReturnType<typeof vi.fn>;
    setTokenEstimator: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('./ui/ChatUI', () => ({
    ChatUI: class {
        public init = vi.fn().mockResolvedValue(undefined);
        public destroy = vi.fn();
        public setEditMessageHandler = vi.fn();
        public updateAttachments = vi.fn();
        public refreshTranslations = vi.fn();
        public revealLatestMessage = vi.fn();
        public renderHistory = vi.fn();
        public showToast = vi.fn();
        public removeTyping = vi.fn();
        public appendMessage = appendMessage;
        public clear = clearUi;
        public updateTokenCount = updateTokenCount;
        public updateContextTokenCount = vi.fn();
    },
}));

vi.mock('./controllers/VoiceController', () => ({
    VoiceController: class {
        public toggle = vi.fn();
        public stop = vi.fn();
    },
}));

vi.mock('./controllers/FilePickerController', () => ({
    FilePickerController: class {
        public pick = vi.fn();
        public updateTokenCount = vi.fn().mockResolvedValue(undefined);
        public handleFileSelect = vi.fn();
    },
}));

vi.mock('./utils/chatUtils', () => ({
    getTokenCount: vi.fn(),
}));

vi.mock('./services/ChatFileHandler', () => ({
    ChatFileHandler: class {
        public clear = vi.fn();
        public setUpdateCallback = vi.fn();
        public clearUpdateCallback = vi.fn();
        public setBridge = vi.fn();
        public setTokenEstimator = vi.fn();
        public hasFiles = vi.fn().mockReturnValue(false);
        public getFiles = vi.fn().mockReturnValue([]);
        public getTotalTokenEstimate = vi.fn().mockResolvedValue(0);
        public processForSend = vi.fn().mockResolvedValue({ attachments: [], combinedText: '' });

        public constructor() {
            mockChatFileHandlerInstances.push({
                clear: this.clear,
                setUpdateCallback: this.setUpdateCallback,
                clearUpdateCallback: this.clearUpdateCallback,
                setBridge: this.setBridge,
                setTokenEstimator: this.setTokenEstimator,
            });
        }
    },
}));

import { ChatController } from './chat';
import type { IChatResponse } from './types/chatTypes';
import { getTokenCount } from './utils/chatUtils';
import { EventBus } from '@/shared/services/EventBus';

type ChatControllerTestAccess = {
    init: () => Promise<void>;
    _chatHistory: Array<{ role: string; content: unknown; thought_signature?: string }>;
    _voice: { stop: ReturnType<typeof vi.fn> };
    _lockUI: (input: HTMLTextAreaElement | null) => unknown;
    _autoResizeInput: () => void;
    _handleChatResponse: (response: IChatResponse, streamingHandle: null) => Promise<void>;
    _checkAIActive: (messageId: string | null) => Promise<boolean>;
    _tryAutoStartAI: () => Promise<boolean>;
    _loadHistory: () => Promise<void>;
    _getFriendlyErrorMessage: (errorMsg: unknown, model?: string) => string;
    clearChat: () => void;
    destroy: () => void;
};

describe('ChatController', () => {
    const aiBridge = {
        isActive: vi.fn(),
        getState: vi.fn().mockReturnValue({ activeProviderId: null, isRunning: false }),
        stopProvider: vi.fn(),
        getSessionId: vi.fn().mockReturnValue('session-1'),
        getContextWindow: vi.fn().mockReturnValue(undefined),
        getHistory: vi.fn().mockResolvedValue([]),
        clearHistory: vi.fn().mockResolvedValue(undefined),
        startProvider: vi.fn().mockResolvedValue(false),
    };

    const i18n = {
        t: vi.fn((_: string, fallback?: string) => fallback ?? ''),
    };

    const soundService = {
        playToggle: vi.fn(),
    };

    const chatDeps = {
        showToast: vi.fn(),
        isTauriRuntime: vi.fn().mockReturnValue(false),
        openExternalUrl: vi.fn().mockResolvedValue(undefined),
        copyText: vi.fn().mockResolvedValue(undefined),
        getPendingChatRevealStore: vi.fn().mockReturnValue(null),
        estimateTokens: vi.fn((text: string) =>
            Promise.resolve(Math.max(1, Math.ceil(text.length / 4))),
        ),
        hostBridge: {
            invoke: vi.fn(),
            listen: vi.fn(),
            isTauri: vi.fn().mockReturnValue(false),
        },
        eventBus: new EventBus(),
        getSelectedModule: vi.fn().mockReturnValue(undefined),
        getPreferredAiCategory: vi.fn().mockReturnValue('ai_text'),
        tracer: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        },
    };

    function createController(): ChatControllerTestAccess {
        return new ChatController(
            aiBridge as never,
            i18n as never,
            soundService as never,
            chatDeps as never,
        ) as unknown as ChatControllerTestAccess;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockChatFileHandlerInstances.length = 0;
        document.body.innerHTML = '';
    });

    it('should use fallback token estimate when reply token counting fails', async () => {
        vi.mocked(getTokenCount).mockRejectedValueOnce(new Error('token fail'));
        const controller = createController();

        await controller._handleChatResponse({ ok: true, message: 'hello' }, null);

        expect(appendMessage).toHaveBeenCalledWith('assistant', 'hello', { tokens: 2 });
        expect(controller._chatHistory).toEqual([{ role: 'assistant', content: 'hello' }]);
    });

    it('should not append delayed inactive-ai error after ai becomes active', async () => {
        vi.useFakeTimers();
        aiBridge.isActive.mockReturnValue(false);
        const controller = createController();
        controller._tryAutoStartAI = vi.fn().mockResolvedValue(false);

        await controller._checkAIActive(null);
        aiBridge.isActive.mockReturnValue(true);
        vi.advanceTimersByTime(500);

        expect(appendMessage).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('should clear pending inactive-ai error timeout when chat is cleared', async () => {
        vi.useFakeTimers();
        aiBridge.isActive.mockReturnValue(false);
        const controller = createController();
        controller._tryAutoStartAI = vi.fn().mockResolvedValue(false);

        await controller._checkAIActive(null);
        controller.clearChat();
        vi.advanceTimersByTime(500);

        expect(appendMessage).not.toHaveBeenCalled();
        expect(clearUi).toHaveBeenCalledTimes(1);
        expect(updateTokenCount).toHaveBeenCalledWith(0, undefined);
        vi.useRealTimers();
    });

    it('should clear file update callback on destroy', () => {
        const controller = createController();

        void controller.init();
        controller.destroy();

        expect(mockChatFileHandlerInstances[0]?.clearUpdateCallback).toHaveBeenCalledTimes(1);
    });

    it('should preserve thought signature in local assistant history', async () => {
        vi.mocked(getTokenCount).mockResolvedValueOnce(5);
        const controller = createController();

        await controller._handleChatResponse(
            { ok: true, message: 'answer', thought_signature: 'sig-1' },
            null,
        );

        expect(controller._chatHistory).toEqual([
            { role: 'assistant', content: 'answer', thought_signature: 'sig-1' },
        ]);
    });

    it('should render generated images as media-first assistant replies', async () => {
        const controller = createController();

        await controller._handleChatResponse(
            {
                ok: true,
                reply: {
                    text: 'caption',
                    images: [{ mime: 'image/png', data_base64: 'ZmFrZQ==' }],
                },
            },
            null,
        );

        expect(appendMessage).toHaveBeenCalledWith('assistant', 'caption', {
            images: [{ mime: 'image/png', data_base64: 'ZmFrZQ==' }],
        });
        expect(controller._chatHistory).toEqual([
            {
                role: 'assistant',
                content: [
                    {
                        type: 'image_url',
                        image_url: { url: 'data:image/png;base64,ZmFrZQ==' },
                    },
                    {
                        type: 'text',
                        text: 'caption',
                    },
                ],
            },
        ]);
    });

    it('should restore multimodal history without flattening stored content', async () => {
        aiBridge.getHistory.mockResolvedValueOnce([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Look here' },
                    {
                        type: 'image_url',
                        image_url: { url: 'data:image/png;base64,ZmFrZQ==' },
                    },
                ],
            },
        ]);

        const controller = createController();

        await controller._loadHistory();

        expect(controller._chatHistory[0]?.content).toEqual([
            { type: 'text', text: 'Look here' },
            {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,ZmFrZQ==' },
            },
        ]);
        expect(
            (
                controller as unknown as {
                    _ui: { renderHistory: ReturnType<typeof vi.fn> };
                }
            )._ui.renderHistory,
        ).toHaveBeenCalledWith([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Look here' },
                    {
                        type: 'image_url',
                        image_url: { url: 'data:image/png;base64,ZmFrZQ==' },
                    },
                ],
            },
        ]);
    });

    it('should localize local model memory errors', () => {
        const controller = createController();

        const message = controller._getFriendlyErrorMessage(
            'Not enough memory to start the local model. Reduce context size or GPU layers, or use a smaller model.',
            'llamacpp',
        );

        expect(message).toBe(
            'Not enough memory to start the local model. Reduce context size or GPU layers, or use a smaller model.',
        );
        expect(i18n.t).toHaveBeenCalledWith(
            'ui.chat.error.local_model_memory',
            'Not enough memory to start the local model. Reduce context size or GPU layers, or use a smaller model.',
        );
    });

    it('should localize image VRAM allocation errors', () => {
        const controller = createController();

        const message = controller._getFriendlyErrorMessage(
            '[ERROR] ggml_backend_cuda_buffer_type_alloc_buffer: allocating 4900.07 MiB on device 0: cudaMalloc failed: out of memory',
            'sdcpp',
        );

        expect(message).toBe(
            'Not enough GPU memory to generate the image. Lower image size, steps, or batch size, or use a smaller model.',
        );
        expect(i18n.t).toHaveBeenCalledWith(
            'ui.chat.error.image_vram',
            'Not enough GPU memory to generate the image. Lower image size, steps, or batch size, or use a smaller model.',
        );
    });

    it('should map provider auth errors to the shared OpenRouter auth message', () => {
        const controller = createController();

        const message = controller._getFriendlyErrorMessage(
            'API Error 403: {"error":{"message":"Invalid API key"}}',
            'openrouter/auto',
        );

        expect(message).toBe(
            'Error: Invalid OpenRouter API key. Please check the key in settings.',
        );
        expect(i18n.t).toHaveBeenCalledWith(
            'ui.chat.error.auth',
            'Error: Invalid OpenRouter API key. Please check the key in settings.',
        );
    });

    it('should map payment errors to the OpenRouter billing message', () => {
        const controller = createController();

        const message = controller._getFriendlyErrorMessage(
            'API Error 402: {"error":{"message":"Payment required. Add credits."}}',
            'openrouter/auto',
        );

        expect(message).toBe(
            'Error 402: Payment Required. Please check your balance at [OpenRouter](https://openrouter.ai/settings/credits).',
        );
        expect(i18n.t).toHaveBeenCalledWith(
            'ui.chat.error.payment_required',
            'Error 402: Payment Required. Please check your balance at [OpenRouter](https://openrouter.ai/settings/credits).',
        );
    });

    it('should map rate limit errors to the shared OpenRouter quota message', () => {
        const controller = createController();

        const message = controller._getFriendlyErrorMessage(
            'API Error 429: {"error":{"message":"Rate limit reached"}}',
            'openrouter/auto',
        );

        expect(message).toBe(
            'Error: OpenRouter or the selected provider hit a rate limit. Wait a bit and try again.',
        );
        expect(i18n.t).toHaveBeenCalledWith(
            'ui.chat.error.quota',
            'Error: OpenRouter or the selected provider hit a rate limit. Wait a bit and try again.',
        );
    });

    it('should map upstream availability errors to the shared OpenRouter server message', () => {
        const controller = createController();

        const message = controller._getFriendlyErrorMessage(
            'API Error 503: {"error":{"message":"Service unavailable"}}',
            'openrouter/auto',
        );

        expect(message).toBe(
            'Error: OpenRouter service is temporarily unavailable. Please try again later.',
        );
        expect(i18n.t).toHaveBeenCalledWith(
            'ui.chat.error.server',
            'Error: OpenRouter service is temporarily unavailable. Please try again later.',
        );
    });

    it('should initialize only once', () => {
        const controller = createController();

        void controller.init();
        void controller.init();

        expect(mockChatFileHandlerInstances[0]?.setUpdateCallback).toHaveBeenCalledTimes(1);
    });

    it('should stop active voice recording on destroy', () => {
        const controller = createController();

        controller.destroy();

        expect(controller._voice.stop).toHaveBeenCalledTimes(1);
    });

    it('should not clear input text while ui is only locked', () => {
        document.body.innerHTML = `
            <textarea id="chat-input">keep me</textarea>
            <button id="chat-send-btn"></button>
            <button id="chat-voice-btn"></button>
            <button id="chat-attach-btn"></button>
        `;

        const controller = createController();
        const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;

        controller._lockUI(input);

        expect(input?.value).toBe('keep me');
        expect(input?.disabled).toBe(true);
    });

    it('should enable textarea scrolling when input exceeds max height', () => {
        document.body.innerHTML = '<textarea id="chat-input"></textarea>';

        const controller = createController();
        const input = document.getElementById('chat-input') as HTMLTextAreaElement;

        Object.defineProperty(input, 'scrollHeight', {
            configurable: true,
            value: 320,
        });

        controller._autoResizeInput();

        expect(input.style.height).toBe('200px');
        expect(input.style.overflowY).toBe('auto');
    });

    it('should send chat on Enter from the textarea', async () => {
        document.body.innerHTML = `
            <input id="chat-file-input" />
            <textarea id="chat-input">hello</textarea>
            <button id="chat-send-btn"></button>
            <button id="chat-voice-btn"></button>
            <button id="chat-attach-btn"></button>
        `;

        aiBridge.isActive.mockReturnValue(true);
        const controller = createController() as unknown as ChatControllerTestAccess & {
            sendChat: () => Promise<void>;
        };
        const sendSpy = vi.spyOn(controller, 'sendChat').mockResolvedValue(undefined);

        await controller.init();

        const input = document.getElementById('chat-input') as HTMLTextAreaElement;
        input.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
            }),
        );

        expect(sendSpy).toHaveBeenCalledTimes(1);
    });
});
