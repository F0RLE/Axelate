/**
 * @module chat/chat
 * @description Main controller for the Chat module
 */

import { ChatService } from './services/ChatService';
import { ChatUI } from './ui/ChatUI';
import type { IChatMessage, IChatResponse } from './types/chatTypes';
import { voiceInputService } from './services/VoiceInputService';
import { chatFileHandler } from './services/ChatFileHandler'; /* Import Singleton */
import { getTokenCount } from './utils/chatUtils';
import { type TGlobalWin } from '@/shared/types/global_bridge_types';
import { logger } from '@/shared/services/LoggerService';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';

export class ChatController {
    private readonly _service: ChatService;
    private readonly _ui: ChatUI;
    private _chatHistory: IChatMessage[] = [];
    /* Removed _chatFiles state - using singleton */

    constructor() {
        this._service = new ChatService();
        // Initialized without arguments
        this._ui = new ChatUI();
        this._init();
    }

    /**
     * Initializes the controller and binds events.
     */
    private _init(): void {
        logger.info('[Chat] Initializing TS Controller...');
        void this._ui.init().catch((err: unknown) => {
            logger.error(`[Chat] UI init failed: ${String(err)}`);
        });
        this._bindEvents();
        this._exposeGlobals();

        // Initial UI State - Link Handler to UI
        chatFileHandler.setUpdateCallback((files, onRemove) => {
            this._ui.updateAttachments(files, onRemove);
            void this._updateTokenCount();
        });

        // Sync initial state
        if (chatFileHandler.hasFiles()) {
            this._ui.updateAttachments(chatFileHandler.getFiles(), (idx) => {
                chatFileHandler.removeFile(idx);
            });
        }

        // Randomize Greeting
        const globalContext = globalThis as TGlobalWin;
        if (typeof globalContext.randomizeChatGreeting === 'function') {
            (globalContext.randomizeChatGreeting as () => void)();
        } else {
            this._randomizeGreeting();
            // Retry after i18n loads (Core splash timeout is ~1.5s)
            setTimeout(() => {
                this._randomizeGreeting();
            }, 500);
            setTimeout(() => {
                this._randomizeGreeting();
            }, 1500);
            setTimeout(() => {
                this._randomizeGreeting();
            }, 3000);
        }

        // Load Persistence History
        void this._loadHistory();
    }

    /**
     * Loads chat history from the backend bridge.
     */
    private async _loadHistory(): Promise<void> {
        const win = globalThis as unknown as Record<string, unknown>;
        const aiBridge = win['aiBridge'] as
            | { getHistory: () => Promise<IChatMessage[]> }
            | undefined;

        if (aiBridge && typeof aiBridge.getHistory === 'function') {
            const history = await aiBridge.getHistory();
            if (Array.isArray(history) && history.length > 0) {
                logger.info(
                    `[ChatController] Restoring ${String(history.length)} messages from persistence`,
                );
                this._chatHistory = history;

                // Redraw UI
                history.forEach((msg) => {
                    const content =
                        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                    this._ui.appendMessage(msg.role as 'user' | 'assistant', content, {
                        tokens: 0, // We could count them but it's historical
                        skipAnimation: true,
                    });
                });
            }
        }
    }

    /**
     * Binds DOM events to controller methods.
     */
    private _bindEvents(): void {
        // Send Button
        // Handled by EventHandler.ts via global exposure

        // File Input
        const fileInput = document.getElementById('chat-file-input') as HTMLInputElement | null;
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                this._handleFileSelect(e);
            });
        }

        // Attach Button (Trigger File Input)
        // Handled by EventHandler.ts via global exposure

        // Voice Button
        // Handled by EventHandler.ts via global exposure

        // Input Key Handler (Enter to send)
        // Input Key Handler (Enter to send)
        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        if (chatInput) {
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void this.sendChat();
                } else {
                    // Slight delay to ensure char is added before measuring
                    setTimeout(() => {
                        this._autoResizeInput();
                    }, 0);
                }
            });
            chatInput.addEventListener('input', () => {
                this._autoResizeInput();
            });
            this._autoResizeInput();
        }
    }

    /**
     * Exposes controller methods to global scope for legacy support.
     */
    private _exposeGlobals(): void {
        const g = globalThis as unknown as Record<string, unknown>;
        g['sendChat'] = () => {
            void this.sendChat();
        };
        g['pickChatFiles'] = () => {
            void this.pickChatFiles();
        };
        g['toggleVoiceInput'] = () => {
            this.toggleVoiceInput();
        };
        g['stopVoiceRecording'] = () => {
            this.stopVoiceRecording();
        };
        g['clearChat'] = () => {
            this.clearChat();
        };
    }

    // --- Actions ---

    /**
     * Entry point for picking files (Native or Web fallback).
     */
    public async pickChatFiles(): Promise<void> {
        const win = globalThis as TGlobalWin;
        // Check if we are in Tauri to use native dialog
        if (win.__TAURI_INTERNALS__ !== undefined) {
            const success = await this._pickNativeFiles(win);
            if (success) return;
        }

        const input = document.getElementById('chat-file-input') as HTMLInputElement | null;
        if (input) input.click();
    }

    /**
     * Internal helper for native file picking via Tauri.
     */
    private async _pickNativeFiles(win: TGlobalWin): Promise<boolean> {
        try {
            const selected = await open({
                multiple: true,
                title: win.t
                    ? win.t('ui.launcher.web.select_files', 'Select Files')
                    : 'Select Files',
            });

            if (selected === null) return true; // User cancelled, don't fallback

            const paths = Array.isArray(selected) ? selected : [selected];
            const files: File[] = [];

            for (const p of paths) {
                const file = await this._readNativeFile(p);
                if (file) files.push(file);
            }

            if (files.length > 0) {
                chatFileHandler.addFiles(files);
                void this._updateTokenCount();
            }
            return true;
        } catch (err) {
            logger.error('[ChatController] Native file picker failed:', err);
            return false;
        }
    }

    /**
     * Handles file selection from the file input.
     */
    private _handleFileSelect(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (input.files) {
            chatFileHandler.addFiles(input.files);
            input.value = '';
            void this._updateTokenCount();
        }
    }

    /**
     * Updates the token count display.
     */
    private async _updateTokenCount(): Promise<void> {
        const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        const text = input ? input.value : '';
        const count = await chatFileHandler.getTotalTokenEstimate(text);
        this._ui.updateTokenCount(count);
    }

    /**
     * Sends the current chat input text and attachments.
     */
    public async sendChat(): Promise<void> {
        const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        const text = (input ? input.value : '').trim();

        if (!this._validateInput(text)) return;
        if (!this._checkAIActive(input)) return;

        const uiElements = this._lockUI(input);
        const typingId = `typing-${String(Date.now())}`;
        const listenerId = `chat-stream-${String(Date.now())}`;

        try {
            const tokenCount = await chatFileHandler.getTotalTokenEstimate(text);
            const { attachments, combinedText } = await chatFileHandler.processForSend(text);

            this._ui.updateTokenCount(0);
            this._ui.appendMessage('user', text, { attachments: attachments, tokens: tokenCount });
            this._chatHistory.push({ role: 'user', content: combinedText });

            this._ui.showTyping(typingId);

            let streamingHandle: {
                update: (chunk: string) => void;
                finalize: (text: string, stats?: Record<string, unknown>) => void;
            } | null = null;

            this._setupStreamingListener(listenerId, (chunk) => {
                if (!streamingHandle) {
                    this._ui.removeTyping(typingId);
                    streamingHandle = this._ui.createStreamingMessage('assistant');
                }
                streamingHandle.update(chunk);
            });

            const historyHead = this._chatHistory.slice(-40);
            const response = await this._service.sendMessage(
                combinedText,
                historyHead,
                attachments,
            );

            this._cleanupStreamingListener(listenerId);
            this._ui.removeTyping(typingId);

            await this._handleChatResponse(response, streamingHandle);
        } catch (e: unknown) {
            this._cleanupStreamingListener(listenerId);
            this._ui.removeTyping(typingId);
            this._handleError(e instanceof Error ? e.message : 'Unknown error');
        } finally {
            this._unlockUI(uiElements);
        }
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

    private _setupStreamingListener(id: string, onChunk: (chunk: string) => void) {
        const win = globalThis as unknown as Record<string, unknown>;
        const aiBridge = win['aiBridge'] as
            | {
                  onChunk: (id: string, cb: (c: string) => void) => void;
              }
            | undefined;
        if (aiBridge !== undefined) {
            aiBridge.onChunk(id, onChunk);
        }
    }

    private _cleanupStreamingListener(id: string) {
        const win = globalThis as unknown as Record<string, unknown>;
        const aiBridge = win['aiBridge'] as
            | {
                  removeChunkListener: (id: string) => void;
              }
            | undefined;
        if (aiBridge !== undefined) {
            aiBridge.removeChunkListener(id);
        }
    }

    /**
     * Validates user input before sending.
     */
    private _validateInput(text: string): boolean {
        if (!text && !chatFileHandler.hasFiles()) {
            this._ui.showToast('Enter a message or attach a file', 'error');
            return false;
        }
        return true;
    }

    /**
     * Checks if AI module is active.
     */
    private _checkAIActive(input: HTMLTextAreaElement | null): boolean {
        const win = globalThis as unknown as Record<string, unknown>;
        const aiBridge = win['aiBridge'] as Record<string, unknown> | undefined;
        const isAIActive =
            typeof aiBridge?.['isActive'] === 'function'
                ? (aiBridge['isActive'] as () => boolean)()
                : false;

        if (!isAIActive) {
            const text = input ? input.value.trim() : '';
            if (text !== '') this._ui.appendMessage('user', text);
            setTimeout(() => {
                const t = win['t'] as ((_k: string, _d: string) => string) | undefined;
                this._ui.appendMessage(
                    'assistant',
                    t?.(
                        'ui.ai.no_provider',
                        'No AI module running. Please launch a module first.',
                    ) ?? 'No AI module running. Please launch a module first.',
                    { error: true },
                );
            }, 500);
            if (input) input.value = '';
            return false;
        }
        return true;
    }

    /**
     * Handles AI response and updates UI.
     */
    private async _handleChatResponse(
        response: IChatResponse,
        streamingHandle?: {
            update: (chunk: string) => void;
            finalize: (text: string, stats?: Record<string, unknown>) => void;
        } | null,
    ): Promise<void> {
        if (response.ok) {
            const replyText = response.message ?? response.reply?.text ?? '';

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

    /**
     * Maps raw error messages to user-friendly localized strings.
     */
    private _getFriendlyErrorMessage(errorMsg: string, model?: string): string {
        const win = globalThis as unknown as Record<string, unknown>;
        const t = win['t'] as ((key: string, def?: string) => string) | undefined;
        if (!t) return errorMsg;

        const msg = (errorMsg || '').toLowerCase();
        const modelName = model ?? 'Gemini';

        // 1. Detect common error codes (handles both plain text and JSON strings)
        // 503 / Unavailable / Overloaded
        if (msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded')) {
            return t(
                'ui.gemini.error.unavailable',
                `Error 503: Service Unavailable (${modelName})`,
            ).replace('{model}', modelName);
        }

        // 429 / Quota / Rate Limit
        if (msg.includes('429') || msg.includes('quota') || msg.includes('limit reached')) {
            return t('ui.gemini.error.quota', `Error 429: Quota Exceeded (${modelName})`).replace(
                '{model}',
                modelName,
            );
        }

        // 403 / Auth / Key
        if (msg.includes('403') || msg.includes('permission_denied') || msg.includes('api key')) {
            return t('ui.gemini.error.auth', `Error 403: Invalid API Key (${modelName})`).replace(
                '{model}',
                modelName,
            );
        }

        // 2. Generic API / OpenAI Fallbacks
        if (msg.includes('quota')) return t('ui.chat.error.quota', 'Quota limit reached');
        if (msg.includes('auth') || msg.includes('api key'))
            return t('ui.chat.error.auth', 'Invalid API Key');
        if (msg.includes('server error') || msg.includes('500'))
            return t('ui.chat.error.server', 'Server error. Please try again later.');

        return errorMsg;
    }

    /**
     * Handles errors by showing them in the UI.
     */
    private _handleError(errorMsg = 'Unknown Error', _model?: string): void {
        this._ui.appendMessage('assistant', errorMsg, { error: true });
    }

    /**
     * Clears chat history and UI.
     */
    public clearChat(): void {
        this._chatHistory = [];
        chatFileHandler.clear(); /* Clear singleton state */
        this._ui.clear();
        this._autoResizeInput();
        this._ui.showToast('Chat cleared', 'success');
    }

    // --- Voice Implementation using VoiceInputService ---

    public toggleVoiceInput(): void {
        if (voiceInputService.isActive()) {
            this.stopVoiceRecording();
            return;
        }

        if (!voiceInputService.isSupported()) {
            this._ui.showToast('Голосовой ввод не поддерживается', 'error');
            return;
        }

        voiceInputService.start(
            (text) => {
                this._onVoiceResult(text);
            },
            (isRecording) => {
                this._onVoiceStateChange(isRecording);
            },
        );
    }

    public stopVoiceRecording(): void {
        voiceInputService.stop();
    }

    /**
     * Handles voice recognition results.
     */
    private _onVoiceResult(text: string): void {
        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        if (chatInput) {
            chatInput.value += (chatInput.value ? ' ' : '') + text;
            this._autoResizeInput();
        }
    }

    /**
     * Updates UI during voice recording states.
     */
    private _onVoiceStateChange(isRecording: boolean): void {
        const voiceBtn = document.getElementById('chat-voice-btn');
        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;

        if (isRecording) {
            this._playVoiceSound(true);
            if (voiceBtn) voiceBtn.style.color = 'var(--danger)';
        } else if (voiceBtn) {
            voiceBtn.style.color = '';
        }

        this._setVoicePlaceholder(isRecording, chatInput);
    }

    private _playVoiceSound(state: boolean): void {
        const win = globalThis as unknown as Record<string, unknown>;
        const soundFX = win['soundFX'] as { playToggle: (_s: boolean) => void } | undefined;
        if (soundFX) soundFX.playToggle(state);
    }

    private _setVoicePlaceholder(isRecording: boolean, input: HTMLTextAreaElement | null): void {
        if (!input) return;
        const win = globalThis as unknown as Record<string, unknown>;
        const t = win['t'] as ((key: string, def?: string) => string) | undefined;

        if (isRecording) {
            input.placeholder = t
                ? t('ui.launcher.web.voice_listening', 'Listening...')
                : 'Listening...';
        } else {
            input.placeholder = t
                ? t('ui.launcher.web.chat_placeholder_ask', 'Ask anything...')
                : 'Ask anything...';
        }
    }

    private _currentGreetingIndex = 1;

    /**
     * Resizes the chat input based on content.
     */
    private _autoResizeInput(): void {
        const el = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        if (el) {
            el.style.height = 'auto';
            const newHeight = Math.min(el.scrollHeight, 200);
            el.style.height = `${String(newHeight)}px`;
        }
    }

    /**
     * Randomizes the chat greeting.
     */
    private _randomizeGreeting(forceIndex?: number): void {
        const el = document.getElementById('chat-header-question');
        if (el) {
            // Use forced index if provided, otherwise random new one
            if (typeof forceIndex === 'number') {
                this._currentGreetingIndex = forceIndex;
            } else {
                const array = new Uint32Array(1);
                crypto.getRandomValues(array);
                this._currentGreetingIndex = ((array[0] ?? 0) % 50) + 1;
            }

            const win = globalThis as unknown as Record<string, unknown>;
            const t = win['t'] as ((key: string, def?: string) => string) | undefined;

            if (t) {
                el.textContent = t(
                    `ui.chat.greeting.${String(this._currentGreetingIndex)}`,
                    'How can I help you today?',
                );
            } else {
                el.textContent = 'How can I help you today?';
            }
        }
    }
    /**
     * Reads a file from a native path and converts it to a web File object.
     */
    private async _readNativeFile(path: string): Promise<File | null> {
        try {
            const data = await readFile(path);
            const name = path.split(/[\\/]/).pop() ?? 'file';
            const ext = name.split('.').pop()?.toLowerCase() ?? '';
            const mimeMap: Record<string, string> = {
                png: 'image/png',
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                gif: 'image/gif',
                webp: 'image/webp',
                svg: 'image/svg+xml',
                txt: 'text/plain',
                md: 'text/markdown',
                json: 'application/json',
                zip: 'application/zip',
            };
            const mime = mimeMap[ext] ?? 'application/octet-stream';
            return new File([data], name, { type: mime });
        } catch (err) {
            logger.error(`[ChatController] Failed to read picked file: ${path}`, err);
            return null;
        }
    }
}

// Instantiate
document.addEventListener('DOMContentLoaded', () => {
    // Keep reference in case we need it, though strictly internal side-effect
    const _controller = new ChatController();

    // Listen for language changes to update greeting in real-time
    globalThis.addEventListener('lang:changed', () => {
        // Valid private method access for this specific context or we could make it public
        const c = _controller as unknown as {
            _randomizeGreeting: (idx?: number) => void;
            _currentGreetingIndex: number;
        };
        c._randomizeGreeting(c._currentGreetingIndex);
    });
});
