import { ChatUI } from '../ui/ChatUI';
import { ChatLifecycleHelper } from './ChatLifecycleHelper';
import { ChatHistoryController } from '../controllers/ChatHistoryController';
import { ChatGenerationController } from '../controllers/ChatGenerationController';
import { ChatSendController } from '../controllers/ChatSendController';
import type { ChatFileHandler } from './ChatFileHandler';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { EventBus } from '@/shared/services/EventBus';
import type { PendingChatRevealStore } from '../chat';
import type { ChatContent } from '@/features/ai/types/aiTypes';
import type { IApp } from '@/shared/types/coreTypes';
import type { IChatAttachment, IChatMessage, IChatResponse } from '../types/chatTypes';
import type { ChatService } from './ChatService';

type ChatTracer = Pick<LoggerService, 'info' | 'warn' | 'error' | 'debug'>;

type ChatFactoryDeps = {
    aiBridge: AIBridge;
    i18n: I18nService;
    tracer: ChatTracer;
    fileHandler: ChatFileHandler;
};

type ChatUiFactoryDeps = ChatFactoryDeps & {
    showToast: (
        message: string,
        type?: 'success' | 'error' | 'warning' | 'info',
        duration?: number,
    ) => void;
    isTauriRuntime: () => boolean;
    openExternalUrl: (url: string) => Promise<void>;
    copyText: (text: string) => Promise<void>;
};

type ChatLifecycleFactoryDeps = {
    fileHandler: ChatFileHandler;
    eventBus: EventBus;
    refreshTranslations: () => void;
    ensureHistoryLoaded: () => Promise<void>;
    scheduleRevealLatestMessage: () => void;
    bindEvents: () => void;
    canBindEventsNow: () => boolean;
    areEventsBound: () => boolean;
    setEventsBound: (value: boolean) => void;
    randomizeGreeting: (forceIndex?: number) => void;
    currentGreetingIndex: () => number;
    updateAttachmentsFromFiles: (
        files: ReturnType<ChatFileHandler['getFiles']>,
        onRemove: (index: number) => void,
    ) => void;
    updateTokenCount: () => Promise<void>;
};

type ChatHistoryFactoryDeps = {
    aiBridge: AIBridge;
    getHistory: () => IChatMessage[];
    setHistory: (history: IChatMessage[]) => void;
    revealLatestMessage: () => void;
    restoreInputText: (text: string) => void;
    renderHistory: (history: IChatMessage[]) => void;
    showEditError: () => void;
    isDestroyed: () => boolean;
    getPendingChatRevealStore: () => PendingChatRevealStore | null;
    tracer: ChatTracer;
};

type ChatGenerationFactoryDeps = {
    aiBridge: AIBridge;
    i18n: I18nService;
    removeTyping: (typingId: string) => void;
    appendAssistantMessage: (text: string, options?: Record<string, unknown>) => void;
    pushAssistantMessage: (content: IChatMessage['content'], thoughtSignature?: string) => void;
    extractText: (data: unknown) => string;
    buildGeneratedImageContent: (
        images: Array<{ mime: string; data_base64: string }>,
        text: string,
    ) => ChatContent;
    estimateReplyTokens: (text: string) => Promise<number>;
    addContextTokens: (tokens: number) => void;
    getFriendlyErrorMessage: (errorMsg: unknown, model?: string) => string;
    handleError: (errorMsg: unknown, model?: string) => void;
    isDestroyed: () => boolean;
    isSending: () => boolean;
    tracer: ChatTracer;
};

type ChatSendFactoryDeps = {
    aiBridge: AIBridge;
    fileHandler: ChatFileHandler;
    service: ChatService;
    getHistory: () => IChatMessage[];
    pushUserMessage: (content: IChatMessage['content']) => void;
    createStreamingHandle: (typingId: string) => {
        setStatus: (text: string) => void;
        update: (chunk: string) => void;
        replace: (chunk: string) => void;
        cancel: () => void;
        finalize: (text: string, stats?: Record<string, unknown>) => void;
        discard: () => void;
    };
    createImageHandle: () => {
        setStatus: (chunk: string) => void;
        setPreview: (dataUrl: string) => void;
        finalize: (result: {
            text: string;
            images: Array<{ mime: string; data_base64: string }>;
        }) => void;
        fail: (message: string) => void;
        cancel: (message?: string) => void;
        discard: () => void;
    };
    translate: (key: string, fallback: string) => string;
    showTyping: (typingId: string) => void;
    registerReplaceChunk: (
        listenerId: string,
        imageHandleRef: () => ReturnType<ChatSendFactoryDeps['createImageHandle']> | null,
        streamingHandleRef: () => ReturnType<ChatSendFactoryDeps['createStreamingHandle']> | null,
    ) => void;
    clearInput: () => void;
    addContextTokens: (count: number) => void;
    appendUserMessage: (text: string, attachments: IChatAttachment[], tokens: number) => void;
    getSelectedModule: (category: 'ai_text' | 'ai_image') => Partial<IApp> | undefined;
    getPreferredAiCategory: () => 'ai_text' | 'ai_image';
    isForceImageGeneration: () => boolean;
    clearForceImageGeneration: () => void;
    handleResponse: (
        response: IChatResponse,
        streamingHandle?: ReturnType<ChatSendFactoryDeps['createStreamingHandle']> | null,
        imageHandle?: ReturnType<ChatSendFactoryDeps['createImageHandle']> | null,
    ) => Promise<void>;
    cleanupStreamingState: (listenerId: string, typingId: string) => void;
    stopImagePreviewPolling: () => void;
    startImagePreviewPolling: (
        handle: ReturnType<ChatSendFactoryDeps['createImageHandle']>,
    ) => void;
    cancelTextGeneration: (providerId: string | null) => Promise<boolean>;
    isImageProvider: (providerId: string | null) => boolean;
    lockUi: (input: HTMLTextAreaElement | null) => {
        input: HTMLTextAreaElement | null;
        sendBtn: HTMLButtonElement | null;
        voiceBtn: HTMLButtonElement | null;
        attachBtn: HTMLButtonElement | null;
        contextBtn: HTMLButtonElement | null;
    };
    unlockUi: (els: {
        input: HTMLTextAreaElement | null;
        sendBtn: HTMLButtonElement | null;
        voiceBtn: HTMLButtonElement | null;
        attachBtn: HTMLButtonElement | null;
        contextBtn: HTMLButtonElement | null;
    }) => void;
    handleError: (error: unknown) => void;
    isSending: () => boolean;
    setSending: (value: boolean) => void;
    tracer: ChatTracer;
};

export class ChatControllerFactory {
    public createUi(deps: ChatUiFactoryDeps): ChatUI {
        return new ChatUI({
            fileHandler: deps.fileHandler,
            translate: deps.i18n.t.bind(deps.i18n),
            showToast: (message, type = 'success', duration = 2000) =>
                deps.showToast(message, type, duration),
            isTauriRuntime: () => deps.isTauriRuntime(),
            openExternalUrl: async (url) => await deps.openExternalUrl(url),
            copyText: async (text) => await deps.copyText(text),
            tracer: deps.tracer,
        });
    }

    public createLifecycleHelper(deps: ChatLifecycleFactoryDeps): ChatLifecycleHelper {
        return new ChatLifecycleHelper({
            fileHandler: deps.fileHandler,
            eventBus: deps.eventBus,
            refreshTranslations: () => {
                deps.refreshTranslations();
            },
            ensureHistoryLoaded: () => deps.ensureHistoryLoaded(),
            scheduleRevealLatestMessage: () => {
                deps.scheduleRevealLatestMessage();
            },
            bindEvents: () => {
                deps.bindEvents();
            },
            canBindEventsNow: () => deps.canBindEventsNow(),
            areEventsBound: () => deps.areEventsBound(),
            setEventsBound: (value) => {
                deps.setEventsBound(value);
            },
            randomizeGreeting: (forceIndex) => {
                deps.randomizeGreeting(forceIndex);
            },
            currentGreetingIndex: () => deps.currentGreetingIndex(),
            updateAttachmentsFromFiles: (files, onRemove) => {
                deps.updateAttachmentsFromFiles(files, onRemove);
            },
            updateTokenCount: () => deps.updateTokenCount(),
        });
    }

    public createHistoryController(deps: ChatHistoryFactoryDeps): ChatHistoryController {
        return new ChatHistoryController({
            aiBridge: deps.aiBridge,
            getHistory: () => deps.getHistory(),
            setHistory: (history) => {
                deps.setHistory(history);
            },
            revealLatestMessage: () => {
                deps.revealLatestMessage();
            },
            restoreInputText: (text) => {
                deps.restoreInputText(text);
            },
            renderHistory: (history) => {
                deps.renderHistory(history);
            },
            showEditError: () => {
                deps.showEditError();
            },
            isDestroyed: () => deps.isDestroyed(),
            getPendingChatRevealStore: () => deps.getPendingChatRevealStore(),
            tracer: deps.tracer,
        });
    }

    public createGenerationController(deps: ChatGenerationFactoryDeps): ChatGenerationController {
        return new ChatGenerationController({
            aiBridge: deps.aiBridge,
            i18n: deps.i18n,
            removeTyping: (typingId) => {
                deps.removeTyping(typingId);
            },
            appendAssistantMessage: (text, options = {}) => {
                deps.appendAssistantMessage(text, options);
            },
            pushAssistantMessage: (content, thoughtSignature) => {
                deps.pushAssistantMessage(content, thoughtSignature);
            },
            extractText: (data) => deps.extractText(data),
            buildGeneratedImageContent: (images, text) =>
                deps.buildGeneratedImageContent(images, text),
            estimateReplyTokens: async (text) => await deps.estimateReplyTokens(text),
            addContextTokens: (tokens) => {
                deps.addContextTokens(tokens);
            },
            getFriendlyErrorMessage: (errorMsg, model) =>
                deps.getFriendlyErrorMessage(errorMsg, model),
            handleError: (errorMsg, model) => {
                deps.handleError(errorMsg, model);
            },
            isDestroyed: () => deps.isDestroyed(),
            isSending: () => deps.isSending(),
            tracer: deps.tracer,
        });
    }

    public createSendController(deps: ChatSendFactoryDeps): ChatSendController {
        return new ChatSendController({
            aiBridge: deps.aiBridge,
            fileHandler: deps.fileHandler,
            service: deps.service,
            getHistory: () => deps.getHistory(),
            pushUserMessage: (content) => {
                deps.pushUserMessage(content);
            },
            createStreamingHandle: (typingId) => deps.createStreamingHandle(typingId),
            createImageHandle: () => deps.createImageHandle(),
            translate: (key, fallback) => deps.translate(key, fallback),
            showTyping: (typingId) => {
                deps.showTyping(typingId);
            },
            registerReplaceChunk: (listenerId, imageHandleRef, streamingHandleRef) => {
                deps.registerReplaceChunk(listenerId, imageHandleRef, streamingHandleRef);
            },
            clearInput: () => {
                deps.clearInput();
            },
            addContextTokens: (count) => {
                deps.addContextTokens(count);
            },
            appendUserMessage: (text, attachments, tokens) => {
                deps.appendUserMessage(text, attachments, tokens);
            },
            getSelectedModule: (category) => deps.getSelectedModule(category),
            getPreferredAiCategory: () => deps.getPreferredAiCategory(),
            isForceImageGeneration: () => deps.isForceImageGeneration(),
            clearForceImageGeneration: () => {
                deps.clearForceImageGeneration();
            },
            handleResponse: async (response, streamingHandle, imageHandle) =>
                await deps.handleResponse(response, streamingHandle, imageHandle),
            cleanupStreamingState: (listenerId, typingId) => {
                deps.cleanupStreamingState(listenerId, typingId);
            },
            stopImagePreviewPolling: () => {
                deps.stopImagePreviewPolling();
            },
            startImagePreviewPolling: (handle) => {
                deps.startImagePreviewPolling(handle);
            },
            cancelTextGeneration: async (providerId) => await deps.cancelTextGeneration(providerId),
            isImageProvider: (providerId) => deps.isImageProvider(providerId),
            lockUi: (input) => deps.lockUi(input),
            unlockUi: (els) => {
                deps.unlockUi(els);
            },
            handleError: (error) => {
                deps.handleError(error);
            },
            isSending: () => deps.isSending(),
            setSending: (value) => {
                deps.setSending(value);
            },
            tracer: deps.tracer,
        });
    }
}
