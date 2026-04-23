/**
 * @module chat/controllers/VoiceController
 * @description Handles voice input recording and transcription for the chat.
 * Extracted from ChatController for SRP compliance.
 */

import type { VoiceInputService } from '../services/VoiceInputService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { SoundService } from '@/shared/services/SoundService';

export class VoiceController {
    constructor(
        private readonly _i18n: I18nService,
        private readonly _soundService: SoundService,
        private readonly _voiceInputService: VoiceInputService,
    ) {}

    /**
     * Toggles voice input on/off.
     * @param onResult - Callback with the transcribed text when recording finishes.
     */
    public toggle(onResult: (text: string) => void): void {
        if (this._voiceInputService.isActive()) {
            this.stop();
            return;
        }

        if (!this._voiceInputService.isSupported()) {
            return;
        }

        this._voiceInputService.start((text) => onResult(text), {
            onStateChange: ({ state }) => this._onStateChange(state),
        });
    }

    public stop(): void {
        this._voiceInputService.stop();
    }

    private _onStateChange(state: 'idle' | 'starting' | 'listening' | 'stopping'): void {
        const voiceBtn = document.getElementById('chat-voice-btn');
        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        const isListening = state === 'listening' || state === 'starting';

        if (state === 'listening') {
            this._soundService.playToggle(true);
        }

        if (isListening) {
            if (voiceBtn) voiceBtn.classList.add('is-recording');
        } else if (voiceBtn) {
            voiceBtn.classList.remove('is-recording');
        }

        this._setPlaceholder(isListening, chatInput);
    }

    private _setPlaceholder(isRecording: boolean, input: HTMLTextAreaElement | null): void {
        if (!input) return;

        input.placeholder = isRecording
            ? this._i18n.t('ui.launcher.web.voice_listening', 'Listening...')
            : this._i18n.t('ui.launcher.web.chat_placeholder_ask', 'Ask anything...');
    }
}
