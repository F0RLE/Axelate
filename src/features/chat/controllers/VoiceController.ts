/**
 * @module chat/controllers/VoiceController
 * @description Handles voice input recording and transcription for the chat.
 * Extracted from ChatController for SRP compliance.
 */

import { voiceInputService } from '../services/VoiceInputService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { SoundService } from '@/shared/services/SoundService';

export class VoiceController {
    constructor(
        private readonly _i18n: I18nService,
        private readonly _soundService: SoundService,
    ) {}

    /**
     * Toggles voice input on/off.
     * @param onResult - Callback with the transcribed text when recording finishes.
     */
    public toggle(onResult: (text: string) => void): void {
        if (voiceInputService.isActive()) {
            this.stop();
            return;
        }

        if (!voiceInputService.isSupported()) {
            return;
        }

        voiceInputService.start(
            (text) => onResult(text),
            (isRecording) => this._onStateChange(isRecording),
        );
    }

    public stop(): void {
        voiceInputService.stop();
    }

    private _onStateChange(isRecording: boolean): void {
        const voiceBtn = document.getElementById('chat-voice-btn');
        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;

        if (isRecording) {
            this._soundService.playToggle(true);
            if (voiceBtn) voiceBtn.classList.add('is-recording');
        } else if (voiceBtn) {
            voiceBtn.classList.remove('is-recording');
        }

        this._setPlaceholder(isRecording, chatInput);
    }

    private _setPlaceholder(isRecording: boolean, input: HTMLTextAreaElement | null): void {
        if (!input) return;

        input.placeholder = isRecording
            ? this._i18n.t('ui.launcher.web.voice_listening', 'Listening...')
            : this._i18n.t('ui.launcher.web.chat_placeholder_ask', 'Ask anything...');
    }
}
