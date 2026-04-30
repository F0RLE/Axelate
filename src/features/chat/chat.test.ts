import { beforeEach, describe, expect, it, vi } from 'vitest';

const appendMessage = vi.fn();
const clearUi = vi.fn();
const updateTokenCount = vi.fn();
const mockChatUiInstances: Array<{
    renderHistory: ReturnType<typeof vi.fn>;
    createImageGenerationMessage: ReturnType<typeof vi.fn>;
    showToast: ReturnType<typeof vi.fn>;
}> = [];
const mockChatFileHandlerInstances: Array<{
    clear: ReturnType<typeof vi.fn>;
    setUpdateCallback: ReturnType<typeof vi.fn>;
    clearUpdateCallback: ReturnType<typeof vi.fn>;
    setBridge: ReturnType<typeof vi.fn>;
    setTokenEstimator: ReturnType<typeof vi.fn>;
}> = [];
const mockVoiceControllerInstances: Array<{
    stop: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('./ui/ChatUI', () => ({
    ChatUI: class {
        public init = vi.fn().mockResolvedValue(undefined);
        public destroy = vi.fn();
        public setEditMessageHandler = vi.fn();
        public setRegenerateMessageHandler = vi.fn();
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
        public createImageGenerationMessage = vi.fn(() => ({
            setStatus: vi.fn(),
            setPreview: vi.fn(),
            finalize: vi.fn(),
            fail: vi.fn(),
            cancel: vi.fn(),
            discard: vi.fn(),
        }));

        public constructor() {
            mockChatUiInstances.push({
                renderHistory: this.renderHistory,
                createImageGenerationMessage: this.createImageGenerationMessage,
                showToast: this.showToast,
            });
        }
    },
}));

vi.mock('./controllers/VoiceController', () => ({
    VoiceController: class {
        public toggle = vi.fn();
        public stop = vi.fn();

        public constructor() {
            mockVoiceControllerInstances.push({
                stop: this.stop,
            });
        }
    },
}));

vi.mock('./controllers/FilePickerController', () => ({
    FilePickerController: class {
        public pick = vi.fn();
        public updateTokenCount = vi.fn().mockResolvedValue(undefined);
        public handleFileSelect = vi.fn();
    },
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
import { ChatContentHelper } from './services/ChatContentHelper';
import { ChatUiStateHelper } from './services/ChatUiStateHelper';
import { EventBus } from '@/shared/services/EventBus';

type ChatControllerTestAccess = {
    init: () => void;
    sendChat: () => Promise<void>;
    clearChat: () => Promise<void>;
    destroy: () => void;
    toggleAttachMenu: () => void;
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
        rewindLastTurn: vi.fn().mockResolvedValue('last prompt'),
        getImageGenerationPreview: vi.fn().mockResolvedValue(null),
        cancelTextGeneration: vi.fn().mockResolvedValue(true),
        cancelImageGeneration: vi.fn().mockResolvedValue(undefined),
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

    function createContentHelper(): ChatContentHelper {
        return new ChatContentHelper(i18n as never, chatDeps.estimateTokens, chatDeps.tracer);
    }

    function createUiStateHelper(): ChatUiStateHelper {
        return new ChatUiStateHelper({
            aiBridge: aiBridge as never,
            i18n: i18n as never,
            showErrorToast: vi.fn(),
            getChatInput: () => document.getElementById('chat-input') as HTMLTextAreaElement | null,
            maxInputHeightPx: 200,
            baseInputHeightPx: 42,
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockChatUiInstances.length = 0;
        mockChatFileHandlerInstances.length = 0;
        mockVoiceControllerInstances.length = 0;
        document.body.innerHTML = '';
    });

    it('should not append delayed inactive-ai error after ai becomes active', async () => {
        vi.useFakeTimers();
        document.body.innerHTML = '<textarea id="chat-input">hello</textarea>';
        aiBridge.isActive.mockReturnValue(false);
        const controller = createController();

        await controller.sendChat();
        aiBridge.isActive.mockReturnValue(true);
        vi.advanceTimersByTime(500);

        expect(appendMessage).not.toHaveBeenCalled();
        expect(mockChatUiInstances[0]?.showToast).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('should clear pending inactive-ai error timeout when chat is cleared', async () => {
        vi.useFakeTimers();
        document.body.innerHTML = '<textarea id="chat-input">hello</textarea>';
        aiBridge.isActive.mockReturnValue(false);
        const controller = createController();

        await controller.sendChat();
        await controller.clearChat();
        vi.advanceTimersByTime(500);

        expect(appendMessage).not.toHaveBeenCalled();
        expect(mockChatUiInstances[0]?.showToast).not.toHaveBeenCalled();
        expect(clearUi).toHaveBeenCalledTimes(1);
        expect(updateTokenCount).toHaveBeenCalledWith(0, undefined);
        vi.useRealTimers();
    });

    it('should show inactive-ai errors as toast instead of chat messages', async () => {
        vi.useFakeTimers();
        document.body.innerHTML = '<textarea id="chat-input">hello</textarea>';
        aiBridge.isActive.mockReturnValue(false);
        const controller = createController();

        await controller.sendChat();
        vi.advanceTimersByTime(500);

        expect(appendMessage).not.toHaveBeenCalled();
        expect(mockChatUiInstances[0]?.showToast).toHaveBeenCalledWith(
            'No AI module running. Please select and launch a module first.',
            'error',
            5000,
        );
        vi.useRealTimers();
    });

    it('should show send failures as toast instead of persistent chat messages', () => {
        const controller = createController();
        const internals = controller as unknown as {
            _handleError: (error: unknown) => void;
        };

        internals._handleError('Provider activation failed');

        expect(appendMessage).not.toHaveBeenCalled();
        expect(mockChatUiInstances[0]?.showToast).toHaveBeenCalledWith(
            'Provider activation failed',
            'error',
            5000,
        );
    });

    it('should cancel active generation before clearing chat', async () => {
        const controller = createController();
        const internals = controller as unknown as {
            _state: { isSending: boolean; currentGenerationProviderId: string | null };
            _sendController: { cancelActiveSend: () => Promise<void> };
        };
        internals._state.isSending = true;
        internals._state.currentGenerationProviderId = 'gpt';
        const cancelSpy = vi
            .spyOn(internals._sendController, 'cancelActiveSend')
            .mockResolvedValue(undefined);

        await controller.clearChat();

        expect(cancelSpy).toHaveBeenCalledOnce();
        expect(clearUi).toHaveBeenCalledOnce();
        expect(internals._state.isSending).toBe(false);
        expect(internals._state.currentGenerationProviderId).toBeNull();
    });

    it('should not restore an image generation placeholder if a send starts while probing preview', async () => {
        let resolvePreview: (
            value: Awaited<ReturnType<typeof aiBridge.getImageGenerationPreview>>,
        ) => void = () => {
            throw new Error('preview promise was not started');
        };
        aiBridge.getImageGenerationPreview.mockReturnValueOnce(
            new Promise((resolve) => {
                resolvePreview = resolve;
            }),
        );
        const controller = createController();
        const internals = controller as unknown as {
            _state: { isSending: boolean };
        };

        controller.init();
        internals._state.isSending = true;
        resolvePreview({
            data_url: 'data:image/png;base64,abc',
            updated_at_ms: 1,
            progress: 0.5,
            step: null,
            total: null,
            speed: null,
            eta_relative: null,
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(mockChatUiInstances[0]?.createImageGenerationMessage).not.toHaveBeenCalled();
    });

    it('should clear file update callback on destroy', () => {
        const controller = createController();

        void controller.init();
        controller.destroy();

        expect(mockChatFileHandlerInstances[0]?.clearUpdateCallback).toHaveBeenCalledTimes(1);
    });

    it('should remove attach menu listeners on destroy', () => {
        const addEventListener = vi.spyOn(document, 'addEventListener');
        document.body.innerHTML = `
            <div id="chat-compose">
                <button id="chat-attach-btn"></button>
            </div>
        `;
        const controller = createController();

        controller.toggleAttachMenu();
        const listenerOptions = addEventListener.mock.calls.find(
            ([eventName]) => eventName === 'mousedown',
        )?.[2];
        if (
            typeof listenerOptions !== 'object' ||
            !('signal' in listenerOptions) ||
            !(listenerOptions.signal instanceof AbortSignal)
        ) {
            throw new Error('attach menu listener signal was not registered');
        }
        controller.destroy();

        expect(document.querySelector('.chat-attach-menu')).toBeNull();
        expect(listenerOptions.signal.aborted).toBe(true);
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

        controller.init();
        await Promise.resolve();
        await Promise.resolve();

        expect(mockChatUiInstances[0]?.renderHistory).toHaveBeenCalledWith([
            {
                role: 'user',
                content: 'Look here',
                opts: {
                    images: [{ mime: 'image/png', data_base64: 'ZmFrZQ==' }],
                },
            },
        ]);
    });

    it('should localize local model memory errors', () => {
        const contentHelper = createContentHelper();

        const message = contentHelper.getFriendlyErrorMessage(
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
        const contentHelper = createContentHelper();

        const message = contentHelper.getFriendlyErrorMessage(
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

    it('should localize local image engine connection failures', () => {
        const contentHelper = createContentHelper();

        const message = contentHelper.getFriendlyErrorMessage(
            'Local image engine request failed at http://localhost:8082/sdapi/v1/txt2img: connection closed. The engine may have stopped, closed the connection, or run out of memory while generating.',
            'sdcpp',
        );

        expect(message).toBe(
            'Local image engine stopped or closed the connection while generating. Restart the image engine and lower image size, steps, or batch size if it happens again.',
        );
        expect(i18n.t).toHaveBeenCalledWith(
            'ui.chat.error.local_image_engine_connection',
            'Local image engine stopped or closed the connection while generating. Restart the image engine and lower image size, steps, or batch size if it happens again.',
        );
    });

    it('should map provider auth errors to the shared OpenRouter auth message', () => {
        const contentHelper = createContentHelper();

        const message = contentHelper.getFriendlyErrorMessage(
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
        const contentHelper = createContentHelper();

        const message = contentHelper.getFriendlyErrorMessage(
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
        const contentHelper = createContentHelper();

        const message = contentHelper.getFriendlyErrorMessage(
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

    it('should map upstream availability errors to a generic server message', () => {
        const contentHelper = createContentHelper();

        const message = contentHelper.getFriendlyErrorMessage(
            'API Error 503: {"error":{"message":"Service unavailable"}}',
            'openrouter/auto',
        );

        expect(message).toBe(
            'Error: The selected AI service is temporarily unavailable. Please try again later.',
        );
        expect(i18n.t).toHaveBeenCalledWith(
            'ui.chat.error.server',
            'Error: The selected AI service is temporarily unavailable. Please try again later.',
        );
    });

    it('should map local engine availability errors without mentioning OpenRouter', () => {
        const contentHelper = createContentHelper();

        const message = contentHelper.getFriendlyErrorMessage(
            'API Error 503: {"error":{"message":"Service unavailable"}}',
            'llamacpp',
        );

        expect(message).toBe(
            'Local model engine is unavailable. Start or restart the selected local model and try again.',
        );
        expect(i18n.t).toHaveBeenCalledWith(
            'ui.chat.error.local_model_unavailable',
            'Local model engine is unavailable. Start or restart the selected local model and try again.',
        );
    });

    it('should map local image input errors to a clear local model message', () => {
        const contentHelper = createContentHelper();

        const message = contentHelper.getFriendlyErrorMessage(
            'API Error 500: {"error":{"message":"image input is not supported - provide the mmproj"}}',
            'llamacpp',
        );

        expect(message).toBe(
            'The selected local text model does not support image input. Remove the image or use a multimodal model with mmproj.',
        );
        expect(i18n.t).toHaveBeenCalledWith(
            'ui.chat.error.local_model_image_input',
            'The selected local text model does not support image input. Remove the image or use a multimodal model with mmproj.',
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

        expect(mockVoiceControllerInstances[0]?.stop).toHaveBeenCalledTimes(1);
    });

    it('should not clear input text while ui is only locked', () => {
        document.body.innerHTML = `
            <textarea id="chat-input">keep me</textarea>
            <button id="chat-send-btn"></button>
            <button id="chat-voice-btn"></button>
            <button id="chat-attach-btn"></button>
        `;

        const uiStateHelper = createUiStateHelper();
        const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;

        uiStateHelper.lockUi(input);

        expect(input?.value).toBe('keep me');
        expect(input?.disabled).toBe(true);
    });

    it('should turn the send button into a stop button while ui is locked', () => {
        document.body.innerHTML = `
            <textarea id="chat-input">prompt</textarea>
            <button id="chat-send-btn"><svg><use href="#icon-send"></use></svg></button>
            <button id="chat-voice-btn"></button>
            <button id="chat-attach-btn"></button>
        `;

        const uiStateHelper = createUiStateHelper();
        const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        const sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement;
        const iconUse = sendBtn.querySelector('use');
        const locked = uiStateHelper.lockUi(input);

        expect(sendBtn.disabled).toBe(false);
        expect(sendBtn.classList.contains('is-generating')).toBe(true);
        expect(sendBtn.getAttribute('aria-label')).toBe('Stop generation');
        expect(iconUse?.getAttribute('href')).toBe('#icon-stop');

        uiStateHelper.unlockUi(locked);

        expect(sendBtn.classList.contains('is-generating')).toBe(false);
        expect(sendBtn.getAttribute('aria-label')).toBe('Send');
        expect(iconUse?.getAttribute('href')).toBe('#icon-send');
    });

    it('should enable textarea scrolling when input exceeds max height', () => {
        document.body.innerHTML = '<textarea id="chat-input">long prompt</textarea>';

        const uiStateHelper = createUiStateHelper();
        const input = document.getElementById('chat-input') as HTMLTextAreaElement;

        Object.defineProperty(input, 'scrollHeight', {
            configurable: true,
            value: 320,
        });

        uiStateHelper.autoResizeInput();

        expect(input.style.height).toBe('200px');
        expect(input.style.overflowY).toBe('auto');
    });

    it('should reset empty textarea to base height after resize', () => {
        document.body.innerHTML = '<textarea id="chat-input"></textarea>';

        const uiStateHelper = createUiStateHelper();
        const input = document.getElementById('chat-input') as HTMLTextAreaElement;
        input.style.height = '200px';

        uiStateHelper.autoResizeInput();

        expect(input.style.height).toBe('42px');
        expect(input.style.overflowY).toBe('hidden');
    });

    it('should send chat on Enter from the textarea', () => {
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

        controller.init();

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
