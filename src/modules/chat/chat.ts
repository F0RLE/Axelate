/**
 * @module chat/chat
 * @description Main controller for the Chat module
 */

import { ChatService } from './services/ChatService';
import { ChatUI } from './ui/ChatUI';
import { IChatMessage, IChatResponse } from './types/chatTypes';
import { voiceInputService } from './services/VoiceInputService';
import { chatFileHandler } from './services/ChatFileHandler'; /* Import Singleton */
import { estimateTokenCount } from './utils/chatUtils';

export class ChatController {
    private readonly _service: ChatService;
    private readonly _ui: ChatUI;
    private _chatHistory: IChatMessage[] = [];
    /* Removed _chatFiles state - using singleton */

    constructor() {
        this._service = new ChatService();
        this._ui = new ChatUI();
        this._init();
    }

    /**
     * Initializes the controller and binds events.
     */
    private _init(): void {
        console.log('[Chat] Initializing TS Controller...');
        this._bindEvents();
        this._exposeGlobals();

        // Initial UI State - Link Handler to UI
        chatFileHandler.setUpdateCallback((files, onRemove) => {
            this._ui.updateAttachments(files, onRemove);
            this._updateTokenCount();
        });
        
        // Sync initial state
        if (chatFileHandler.hasFiles()) {
             this._ui.updateAttachments(chatFileHandler.getFiles(), (idx) => chatFileHandler.removeFile(idx));
        }

        // Randomize Greeting
        const globalContext = globalThis as unknown as Record<string, unknown>;
        if (typeof globalContext.randomizeChatGreeting === 'function') {
            (globalContext.randomizeChatGreeting as () => void)();
        } else {
            this._randomizeGreeting();
            // Retry after i18n loads (Core splash timeout is ~1.5s)
            setTimeout(() => this._randomizeGreeting(), 500);
            setTimeout(() => this._randomizeGreeting(), 1500);
            setTimeout(() => this._randomizeGreeting(), 3000);
        }
    }

    /**
     * Binds DOM events to controller methods.
     */
    private _bindEvents(): void {
        // Send Button
        const sendBtn = document.getElementById('chat-send-btn');
        if (sendBtn) {
            sendBtn.addEventListener('click', () => this.sendChat());
        }

        // File Input
        const fileInput = document.getElementById('chat-file-input') as HTMLInputElement;
        if (fileInput) {
            fileInput.addEventListener('change', (e) => this._handleFileSelect(e));
        }

        // Attach Button (Trigger File Input)
        const attachBtn = document.getElementById('chat-attach-btn');
        if (attachBtn && fileInput) {
            attachBtn.addEventListener('click', () => fileInput.click());
        }

        // Voice Button
        const voiceBtn = document.getElementById('chat-voice-btn');
        if (voiceBtn) {
            voiceBtn.addEventListener('click', () => this.toggleVoiceInput());
        }

        // Input Key Handler (Enter to send)
        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
        if (chatInput) {
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChat();
                } else {
                    // Slight delay to ensure char is added before measuring
                    setTimeout(() => this._autoResizeInput(), 0);
                }
            });
            chatInput.addEventListener('input', () => {
                this._updateTokenCount();
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
        g.sendChat = () => this.sendChat();
        g.pickChatFiles = () => {
            const input = document.getElementById('chat-file-input');
            if (input) (input as HTMLInputElement).click();
        };
        g.toggleVoiceInput = () => this.toggleVoiceInput();
        g.stopVoiceRecording = () => this.stopVoiceRecording();
        g.clearChat = () => this.clearChat();
    }


    // --- Actions ---

    /**
     * Handles file selection from the file input.
     */
    private _handleFileSelect(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (input.files) {
            chatFileHandler.addFiles(input.files);
            input.value = '';
            this._updateTokenCount();
        }
    }

    /**
     * Updates the token count display.
     */
    private async _updateTokenCount(): Promise<void> {
        const input = document.getElementById('chat-input') as HTMLTextAreaElement;
        const text = input ? input.value : '';
        const count = await chatFileHandler.getTotalTokenEstimate(text);
        this._ui.updateTokenCount(count);
    }

    /**
     * Sends the current chat input text and attachments.
     */
    public async sendChat(): Promise<void> {
        const input = document.getElementById('chat-input') as HTMLTextAreaElement;
        const text = (input ? input.value : '').trim();

        if (!this._validateInput(text)) return;
        if (!this._checkAIActive(input)) return;

        if (input) {
            input.value = '';
            this._autoResizeInput();
        }

        const listenerId = 'chat-stream-' + Date.now();
        // Defined as structural type to avoid heavy UI dependency import
        interface IStreamingHandle {
             update: (chunk: string) => void;
             finalize: (text: string, stats?: Record<string, unknown>) => void;
        }
        let streamingHandle: IStreamingHandle | null = null;

        try {
            // Calculate tokens BEFORE processing
            const tokenCount = await chatFileHandler.getTotalTokenEstimate(text);

            const { attachments, combinedText } = await chatFileHandler.processForSend(text);
            this._ui.updateTokenCount(0); 
            
            this._ui.appendMessage('user', text, { attachments: attachments, tokens: tokenCount });
            this._chatHistory.push({ role: 'user', content: combinedText });

            const typingId = 'typing-' + Date.now();
            this._ui.showTyping(typingId);

            // Set up real-time streaming listener
            const win = globalThis as unknown as Record<string, unknown>;
            // Cast to specific interface to allow property access
            const aiBridge = win.aiBridge as { onChunk: (id: string, cb: (c: string) => void) => void; removeChunkListener: (id: string) => void };
            
            aiBridge.onChunk(listenerId, (chunk: string) => {
                if (!streamingHandle) {
                    this._ui.removeTyping(typingId);
                    streamingHandle = this._ui.createStreamingMessage('assistant');
                }
                if (streamingHandle) {
                    streamingHandle.update(chunk);
                }
            });

            const historyHead = this._chatHistory.slice(-40);
            const response = await this._service.sendMessage(combinedText, historyHead, attachments);

            // Cleanup listener
            aiBridge.removeChunkListener(listenerId);
            this._ui.removeTyping(typingId);

            this._handleChatResponse(response, streamingHandle);

        } catch (e: unknown) {
            const win = globalThis as unknown as Record<string, unknown>;
            if (win.aiBridge) (win.aiBridge as { removeChunkListener: (id: string) => void }).removeChunkListener(listenerId);
            
            const errorMsg = e instanceof Error ? e.message : 'Unknown error';
            this._handleError(errorMsg);
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
    private _checkAIActive(input: HTMLTextAreaElement): boolean {
        const win = globalThis as unknown as Record<string, unknown>;
        const aiBridge = win.aiBridge as Record<string, unknown>;
        const isAIActive = typeof aiBridge?.isActive === 'function' ? (aiBridge.isActive as () => boolean)() : false;

        if (!isAIActive) {
             const text = input ? input.value.trim() : '';
             if (text) this._ui.appendMessage('user', text);
             setTimeout(() => {
                  const t = win.t as (_k: string, _d: string) => string;
                  this._ui.appendMessage('assistant',
                      t?.('ui.ai.no_provider', 'No AI module running. Please launch a module first.')
                      || 'No AI module running. Please launch a module first.',
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
    private _handleChatResponse(response: IChatResponse, streamingHandle?: { update: (chunk: string) => void; finalize: (text: string, stats?: Record<string, unknown>) => void } | null): void {
        if (response.ok) {
            const replyText = response.message || response.reply?.text || '';

            if (replyText) {
                 const tokens = estimateTokenCount(replyText);
                 
                 if (streamingHandle) {
                     streamingHandle.finalize(replyText, { tokens });
                 } else {
                     this._ui.appendMessage('assistant', replyText, { tokens });
                 }
                 
                 this._chatHistory.push({ role: 'assistant', content: replyText });
            }
        } else {
            const friendlyMsg = this._getFriendlyErrorMessage(response.error || '', response.model);
            this._handleError(friendlyMsg, response.model);
        }
    }

    /**
     * Maps raw error messages to user-friendly localized strings.
     */
    private _getFriendlyErrorMessage(errorMsg: string, model?: string): string {
        const win = globalThis as unknown as Record<string, unknown>;
        const t = win.t as (key: string, def?: string) => string;
        if (!t) return errorMsg;

        const msg = (errorMsg || '').toLowerCase();
        const modelName = model || 'Gemini';

        // 1. Detect common error codes (handles both plain text and JSON strings)
        // 503 / Unavailable / Overloaded
        if (msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded')) {
            return t('ui.gemini.error.unavailable', `Error 503: Service Unavailable (${modelName})`)
                    .replace('{model}', modelName);
        }
        
        // 429 / Quota / Rate Limit
        if (msg.includes('429') || msg.includes('quota') || msg.includes('limit reached')) {
            return t('ui.gemini.error.quota', `Error 429: Quota Exceeded (${modelName})`)
                    .replace('{model}', modelName);
        }

        // 403 / Auth / Key
        if (msg.includes('403') || msg.includes('permission_denied') || msg.includes('api key')) {
            return t('ui.gemini.error.auth', `Error 403: Invalid API Key (${modelName})`)
                    .replace('{model}', modelName);
        }

        // 2. Generic API / OpenAI Fallbacks
        if (msg.includes('quota')) return t('ui.chat.error.quota', 'Quota limit reached');
        if (msg.includes('auth') || msg.includes('api key')) return t('ui.chat.error.auth', 'Invalid API Key');
        if (msg.includes('server error') || msg.includes('500')) return t('ui.chat.error.server', 'Server error. Please try again later.');

        return errorMsg;
    }

    /**
     * Handles errors by showing them in the UI.
     */
    private _handleError(errorMsg: string = 'Unknown Error', _model?: string): void {
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
            (text) => this._onVoiceResult(text),
            (isRecording) => this._onVoiceStateChange(isRecording)
        );
    }

    public stopVoiceRecording(): void {
        voiceInputService.stop();
    }

    /**
     * Handles voice recognition results.
     */
    private _onVoiceResult(text: string): void {
        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
        if (chatInput && text) {
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
        const soundFX = win.soundFX as { playToggle: (_s: boolean) => void } | undefined;
        if (soundFX) soundFX.playToggle(state);
    }

    private _setVoicePlaceholder(isRecording: boolean, input: HTMLTextAreaElement | null): void {
        if (!input) return;
        const win = globalThis as unknown as Record<string, unknown>;
        const t = win.t as (key: string, def?: string) => string;

        if (isRecording) {
            input.placeholder = t ? t('ui.launcher.web.voice_listening', 'Listening...') : 'Listening...';
        } else {
            input.placeholder = t ? t('ui.launcher.web.chat_placeholder_ask', 'Ask anything...') : 'Ask anything...';
        }
    }

    private _currentGreetingIndex: number = 1;

    /**
     * Resizes the chat input based on content.
     */
    private _autoResizeInput(): void {
        const el = document.getElementById('chat-input') as HTMLTextAreaElement;
        if (el) {
            el.style.height = 'auto';
            const newHeight = Math.min(el.scrollHeight, 200);
            el.style.height = newHeight + 'px';
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
                 this._currentGreetingIndex = (array[0] % 50) + 1;
             }

             const win = globalThis as unknown as Record<string, unknown>;
             const t = win.t as (key: string, def?: string) => string;
             
             if (t) {
                el.textContent = t(`ui.chat.greeting.${this._currentGreetingIndex}`, 'How can I help you today?');
             } else {
                el.textContent = 'How can I help you today?';
             }
         }
    }
}

// Instantiate
document.addEventListener('DOMContentLoaded', () => {
    // Keep reference in case we need it, though strictly internal side-effect
    const _controller = new ChatController();

    // Listen for language changes to update greeting in real-time
    globalThis.addEventListener('lang:changed', () => {
        // @ts-ignore - Valid private method access for this specific context or we could make it public
        _controller['_randomizeGreeting'](_controller['_currentGreetingIndex']);
    });
});

