/**
 * @module chat/chat
 * @description Main controller for the Chat module.
 * Composes VoiceController and FilePickerController for SRP compliance.
 */

import { ChatService } from './services/ChatService';
import { ChatUI } from './ui/ChatUI';
import type { IChatMessage, IChatResponse } from './types/chatTypes';
import { chatFileHandler } from './services/ChatFileHandler';
import { getTokenCount } from './utils/chatUtils';
import { tracer } from '@/infrastructure/logging/LoggerService';
import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { SoundService } from '@/shared/services/SoundService';
import { eventBus } from '@/shared/services/EventBus';
import { VoiceController } from './controllers/VoiceController';
import { FilePickerController } from './controllers/FilePickerController';
import { getGlobalWin } from '@/shared/utils/globalAccessor';

export class ChatController {
    private readonly _service: ChatService;
    private readonly _ui: ChatUI;
    private readonly _voice: VoiceController;
    private readonly _filePicker: FilePickerController;
    private _chatHistory: IChatMessage[] = [];
    private _currentGreetingIndex = 1;
    private _isSending = false;
    private _historyLoaded = false;
    private _historyLoadInFlight: Promise<void> | null = null;
    private _eventsBound = false;
    private _pageChangeUnsub: (() => void) | null = null;
    private _translationsLoadedUnsub: (() => void) | null = null;
    private readonly _boundFileInputChange = (e: Event) => this._filePicker.handleFileSelect(e);
    private readonly _boundChatInputKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void this.sendChat();
        } else {
            setTimeout(() => this._autoResizeInput(), 0);
        }
    };
    private readonly _boundChatInputInput = () => this._autoResizeInput();

    constructor(
        private readonly _aiBridge: AIBridge,
        private readonly _i18n: I18nService,
        _soundService: SoundService,
    ) {
        this._service = new ChatService(_aiBridge, _i18n);
        this._ui = new ChatUI();
        this._voice = new VoiceController(_i18n, _soundService);
        this._filePicker = new FilePickerController(_i18n, this._ui);
    }

    // --- Lifecycle ---

    public init(): void {
        tracer.info('[Chat] Initializing TS Controller...');
        void this._ui.init().catch((err: unknown) => {
            tracer.error(`[Chat] UI init failed: ${String(err)}`);
        });
        this._ui.setEditMessageHandler(async (text) => {
            await this._editLastTurn(text);
        });

        chatFileHandler.setUpdateCallback((files, onRemove) => {
            this._ui.updateAttachments(files, onRemove);
            void this._filePicker.updateTokenCount();
        });

        if (chatFileHandler.hasFiles()) {
            this._ui.updateAttachments(chatFileHandler.getFiles(), (idx) => {
                chatFileHandler.removeFile(idx);
            });
        }

        void this._ensureHistoryLoaded();

        this._pageChangeUnsub = eventBus.on('page:change', (data) => {
            if (data.pageId === 'chat') {
                // Bind DOM events the first time the chat page is actually shown
                if (!this._eventsBound) {
                    this._bindEvents();
                    this._eventsBound = true;
                }
                this.randomizeGreeting();
                this._ui.refreshTranslations();
                void this._ensureHistoryLoaded();
            }
        });

        this._translationsLoadedUnsub = eventBus.on('i18n:translations:loaded', () => {
            this.randomizeGreeting(this._currentGreetingIndex);
            this._ui.refreshTranslations();
        });
    }

    public destroy(): void {
        this._pageChangeUnsub?.();
        this._pageChangeUnsub = null;
        this._translationsLoadedUnsub?.();
        this._translationsLoadedUnsub = null;

        const fileInput = document.getElementById('chat-file-input') as HTMLInputElement | null;
        fileInput?.removeEventListener('change', this._boundFileInputChange);

        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        chatInput?.removeEventListener('keydown', this._boundChatInputKeydown);
        chatInput?.removeEventListener('input', this._boundChatInputInput);

        this._ui.destroy();
    }

    // --- Public Actions ---

    public async pickChatFiles(): Promise<void> {
        await this._filePicker.pick();
    }

    public toggleVoiceInput(): void {
        this._voice.toggle((text) => {
            const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
            if (chatInput) {
                chatInput.value += (chatInput.value ? ' ' : '') + text;
                this._autoResizeInput();
            }
        });
    }

    public stopVoiceRecording(): void {
        this._voice.stop();
    }

    public clearChat(): void {
        this._chatHistory = [];
        chatFileHandler.clear();
        this._ui.clear();
        this._autoResizeInput();
        void this._aiBridge.clearHistory().catch((e: unknown) => {
            tracer.error('[Chat] Failed to clear persisted history:', e);
        });
        this._ui.showToast(this._i18n.t('ui.chat.cleared', 'Chat cleared'), 'success');
    }

    // --- Send Message ---

    public async sendChat(): Promise<void> {
        if (this._isSending) return;

        const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        const text = (input ? input.value : '').trim();

        if (!this._validateInput(text)) return;

        const isActive = await this._checkAIActive(input);
        if (!isActive) return;

        const uiElements = this._lockUI(input);
        const typingId = `typing-${String(Date.now())}`;
        const listenerId = `chat-stream-${String(Date.now())}`;

        this._isSending = true;

        try {
            const tokenCount = await chatFileHandler.getTotalTokenEstimate(text);
            const { attachments, combinedText } = await chatFileHandler.processForSend(text);
            const historyHead = this._chatHistory.slice(-40);

            this._ui.updateTokenCount(0);
            this._ui.appendMessage('user', text, { attachments: attachments, tokens: tokenCount });
            this._chatHistory.push({ role: 'user', content: combinedText });

            this._ui.showTyping(typingId);

            let streamingHandle: {
                update: (chunk: string) => void;
                replace: (chunk: string) => void;
                finalize: (text: string, stats?: Record<string, unknown>) => void;
            } | null = null;

            this._aiBridge.onChunk(listenerId, (chunk) => {
                if (!streamingHandle) {
                    this._ui.removeTyping(typingId);
                    streamingHandle = this._ui.createStreamingMessage('assistant');
                }
                streamingHandle.update(chunk);
            });

            this._aiBridge.onReplaceChunk(listenerId, (chunk) => {
                if (!streamingHandle) {
                    this._ui.removeTyping(typingId);
                    streamingHandle = this._ui.createStreamingMessage('assistant');
                }
                streamingHandle.replace(chunk);
            });

            const response = await this._service.sendMessage(
                combinedText,
                historyHead,
                attachments,
            );

            this._aiBridge.removeChunkListener(listenerId);
            this._aiBridge.removeReplaceChunkListener(listenerId);
            this._ui.removeTyping(typingId);

            await this._handleChatResponse(response, streamingHandle);
        } catch (e: unknown) {
            this._aiBridge.removeChunkListener(listenerId);
            this._aiBridge.removeReplaceChunkListener(listenerId);
            this._ui.removeTyping(typingId);
            this._handleError(e);
        } finally {
            this._unlockUI(uiElements);
            this._isSending = false;
        }
    }

    // --- Greeting ---

    public randomizeGreeting(forceIndex?: number): void {
        const el = document.getElementById('chat-header-question');
        if (el) {
            if (typeof forceIndex === 'number') {
                this._currentGreetingIndex = forceIndex;
            } else {
                const array = new Uint32Array(1);
                crypto.getRandomValues(array);
                this._currentGreetingIndex = ((array[0] ?? 0) % 50) + 1;
            }

            const translation = this._i18n.t(
                `ui.chat.greeting.${String(this._currentGreetingIndex)}`,
                '',
            );

            if (
                translation === '' ||
                translation === `ui.chat.greeting.${String(this._currentGreetingIndex)}`
            ) {
                const fallbackGreeting = this._i18n.t(
                    'ui.chat.greeting.default',
                    'How can I help you today?',
                );
                if (el.textContent === '' || el.textContent === fallbackGreeting) {
                    el.textContent = fallbackGreeting;
                }
                return;
            }

            el.textContent = translation;
        }
    }

    // --- Private Helpers ---

    private _bindEvents(): void {
        const fileInput = document.getElementById('chat-file-input') as HTMLInputElement | null;
        if (fileInput) {
            fileInput.addEventListener('change', this._boundFileInputChange);
        }

        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        if (chatInput) {
            chatInput.addEventListener('keydown', this._boundChatInputKeydown);
            chatInput.addEventListener('input', this._boundChatInputInput);
            this._autoResizeInput();
        }
    }

    private async _ensureHistoryLoaded(): Promise<void> {
        if (this._historyLoaded) return;
        if (this._historyLoadInFlight !== null) {
            await this._historyLoadInFlight;
            return;
        }

        if (this._aiBridge.getSessionId() === 'default') {
            globalThis.setTimeout(() => {
                void this._ensureHistoryLoaded();
            }, 300);
            return;
        }

        this._historyLoadInFlight = this._loadHistory();
        await this._historyLoadInFlight;
        this._historyLoadInFlight = null;
    }

    private async _editLastTurn(text: string): Promise<void> {
        if (this._isSending) return;

        try {
            const removedText = await this._aiBridge.rewindLastTurn();
            const nextText = removedText ?? text;

            this._rewindLocalHistory();
            this._ui.renderHistory(this._chatHistory);
            this._restoreInputText(nextText);
        } catch (error: unknown) {
            tracer.error('[Chat] Failed to rewind last turn:', error);
            this._ui.showToast(
                this._i18n.t('ui.chat.edit_last_turn_failed', 'Failed to edit last turn'),
                'error',
            );
        }
    }

    private _rewindLocalHistory(): void {
        while (this._chatHistory.length > 0) {
            const lastMessage = this._chatHistory[this._chatHistory.length - 1];
            if (lastMessage?.role === 'user') {
                break;
            }
            this._chatHistory.pop();
        }

        const lastMessage = this._chatHistory[this._chatHistory.length - 1];
        if (lastMessage?.role === 'user') {
            this._chatHistory.pop();
        }
    }

    private _restoreInputText(text: string): void {
        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        if (!(chatInput instanceof HTMLTextAreaElement)) return;

        chatInput.value = text;
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
        chatInput.focus();
        chatInput.setSelectionRange(text.length, text.length);
        this._autoResizeInput();
    }

    private async _loadHistory(): Promise<void> {
        const history = await this._aiBridge.getHistory();
        this._historyLoaded = true;
        if (Array.isArray(history) && history.length > 0) {
            tracer.info(
                `[ChatController] Restoring ${String(history.length)} messages from persistence`,
            );

            this._chatHistory = history
                .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
                .map((msg) => ({
                    role: msg.role as 'user' | 'assistant',
                    content: this._safeExtractText(msg.content),
                }));

            this._chatHistory.forEach((msg) => {
                this._ui.appendMessage(msg.role, msg.content, {
                    tokens: 0,
                    skipAnimation: true,
                });
            });
        }

        if (this._consumePendingChatReveal()) {
            this._ui.revealLatestMessage();
        }
    }

    private _consumePendingChatReveal(): boolean {
        type PendingUiState = {
            getState: () => { pending_chat_reveal?: boolean };
            updateState: (updates: { pending_chat_reveal: boolean }) => void;
        };
        const win = getGlobalWin() as unknown as Window & {
            uiState?: {
                getState?: PendingUiState['getState'];
                updateState?: PendingUiState['updateState'];
            };
        };

        const uiState = win.uiState as PendingUiState | undefined;
        const pendingState = uiState?.getState();
        const shouldReveal = pendingState?.pending_chat_reveal === true;
        if (shouldReveal) {
            uiState?.updateState({ pending_chat_reveal: false });
        }
        return shouldReveal;
    }

    private _validateInput(text: string): boolean {
        if (!text && !chatFileHandler.hasFiles()) {
            this._ui.showToast(
                this._i18n.t('ui.chat.input_required', 'Enter a message or attach a file'),
                'error',
            );
            return false;
        }
        return true;
    }

    private async _tryAutoStartAI(): Promise<boolean> {
        const textModule = uiState.getSelectedModule('ai_text');
        const imageModule = uiState.getSelectedModule('ai_image');

        // Prefer text module for chat naturally, but allow image module if active
        const selectedModule =
            textModule?.id !== undefined && textModule.id !== '' ? textModule : imageModule;

        if (selectedModule?.id === undefined || selectedModule.id === '') return false;

        tracer.info(`[Chat] Auto-starting selected module: ${selectedModule.id}`);
        const btn = document.getElementById('chat-actions-send');
        if (btn) {
            btn.classList.add('loading');
            btn.setAttribute('disabled', 'true');
        }

        const started = await this._aiBridge.startProvider(selectedModule.id);

        if (btn) {
            btn.classList.remove('loading');
            btn.removeAttribute('disabled');
        }

        return started;
    }

    private async _checkAIActive(input: HTMLTextAreaElement | null): Promise<boolean> {
        if (this._aiBridge.isActive()) return true;

        const started = await this._tryAutoStartAI();
        if (started) return true;

        const text = input ? input.value.trim() : '';
        if (text !== '') this._ui.appendMessage('user', text);
        setTimeout(() => {
            this._ui.appendMessage(
                'assistant',
                this._i18n.t(
                    'ui.ai.no_provider',
                    'No AI module running. Please select and launch a module first.',
                ),
                { error: true },
            );
        }, 500);
        if (input) input.value = '';
        return false;
    }

    private async _handleChatResponse(
        response: IChatResponse,
        streamingHandle?: {
            update: (chunk: string) => void;
            finalize: (text: string, stats?: Record<string, unknown>) => void;
        } | null,
    ): Promise<void> {
        if (response.ok) {
            const rawReply = response.message ?? response.reply?.text ?? '';
            const replyText = this._safeExtractText(rawReply);

            if (replyText !== '') {
                const tokens = await getTokenCount(replyText);

                if (streamingHandle) {
                    streamingHandle.finalize(replyText, { tokens });
                } else {
                    this._ui.appendMessage('assistant', replyText, { tokens });
                }

                this._chatHistory.push({ role: 'assistant', content: replyText });
            }
        } else {
            const friendlyMsg = this._getFriendlyErrorMessage(response.error ?? '', response.model);
            this._handleError(friendlyMsg, response.model);
        }
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

    private _safeExtractText(data: unknown): string {
        if (typeof data === 'string') return data;
        if (data instanceof Error) return data.message;

        if (typeof data === 'object' && data !== null) {
            return this._extractFromObject(data as Record<string, unknown>);
        }

        return typeof data === 'number' || typeof data === 'boolean' ? String(data) : '';
    }

    private _getFriendlyErrorMessage(errorMsg: unknown, model?: string): string {
        const msgStr = this._safeExtractText(errorMsg) || 'Unknown Error';
        const msg = msgStr.toLowerCase();
        const modelName = model ?? 'Gemini';

        if (msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded')) {
            return this._i18n
                .t('ui.gemini.error.unavailable', `Error 503: Service Unavailable (${modelName})`)
                .replace('{model}', modelName);
        }

        if (msg.includes('429') || msg.includes('quota') || msg.includes('limit reached')) {
            return this._i18n
                .t('ui.gemini.error.quota', `Error 429: Quota Exceeded (${modelName})`)
                .replace('{model}', modelName);
        }

        if (msg.includes('402') || msg.includes('payment required') || msg.includes('credits')) {
            return this._i18n
                .t(
                    'ui.chat.error.payment_required',
                    `Error 402: Payment Required. Please check your balance at [OpenRouter](https://openrouter.ai/settings/credits).`,
                )
                .replace('{model}', modelName);
        }

        if (msg.includes('403') || msg.includes('permission_denied') || msg.includes('api key')) {
            return this._i18n
                .t('ui.gemini.error.auth', `Error 403: Invalid API Key (${modelName})`)
                .replace('{model}', modelName);
        }

        if (msg.includes('quota'))
            return this._i18n.t('ui.chat.error.quota', 'Quota limit reached');
        if (msg.includes('auth') || msg.includes('api key'))
            return this._i18n.t('ui.chat.error.auth', 'Invalid API Key');
        if (msg.includes('server error') || msg.includes('500'))
            return this._i18n.t('ui.chat.error.server', 'Server error. Please try again later.');

        return msgStr;
    }

    private _handleError(errorMsg: unknown = 'Unknown Error', _model?: string): void {
        const msgStr = this._safeExtractText(errorMsg) || 'Unknown Error';

        this._ui.appendMessage('assistant', msgStr, { error: true });
    }

    private _lockUI(input: HTMLTextAreaElement | null) {
        const sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement | null;
        const voiceBtn = document.getElementById('chat-voice-btn') as HTMLButtonElement | null;
        const attachBtn = document.getElementById('chat-attach-btn') as HTMLButtonElement | null;

        if (input) {
            input.value = '';
            input.disabled = true;
            this._autoResizeInput();
        }
        if (sendBtn) sendBtn.disabled = true;
        if (voiceBtn) voiceBtn.disabled = true;
        if (attachBtn) attachBtn.disabled = true;

        return { input, sendBtn, voiceBtn, attachBtn };
    }

    private _unlockUI(els: {
        input: HTMLTextAreaElement | null;
        sendBtn: HTMLButtonElement | null;
        voiceBtn: HTMLButtonElement | null;
        attachBtn: HTMLButtonElement | null;
    }) {
        if (els.input) {
            els.input.disabled = false;
            els.input.focus();
        }
        if (els.sendBtn) els.sendBtn.disabled = false;
        if (els.voiceBtn) els.voiceBtn.disabled = false;
        if (els.attachBtn) els.attachBtn.disabled = false;
    }

    private _autoResizeInput(): void {
        const el = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        if (el) {
            el.style.height = 'auto';
            const newHeight = Math.min(el.scrollHeight, 200);
            el.style.height = `${String(newHeight)}px`;
        }
    }
}
