/**
 * @module chat/controllers/VoiceController
 * @description Handles voice input recording and transcription for the chat.
 * Extracted from ChatController for SRP compliance.
 */

import type { VoiceInputService } from '../services/VoiceInputService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { SoundService } from '@/shared/services/SoundService';

type VoiceToast = (
    message: string,
    type?: 'success' | 'error' | 'warning' | 'info',
    duration?: number,
    title?: string | null,
    id?: string | null,
    onClick?: (() => void) | null,
) => void;

type VoiceSettingsOpener = () => Promise<void>;

export class VoiceController {
    constructor(
        private readonly _i18n: I18nService,
        private readonly _soundService: SoundService,
        private readonly _voiceInputService: VoiceInputService,
        private readonly _showToast: VoiceToast,
        private readonly _openVoiceSettings: VoiceSettingsOpener,
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
            this._showToast(
                this._i18n.t(
                    'ui.chat.voice.unsupported',
                    'Voice input is available only in the desktop app.',
                ),
                'warning',
                2600,
            );
            return;
        }

        const didStart = this._voiceInputService.start((text) => onResult(text), {
            onStateChange: ({ state }) => this._onStateChange(state),
            onError: (error) => this._onError(error),
        });

        if (!didStart) {
            this._showToast(
                this._i18n.t('ui.chat.voice.start_failed', 'Could not start voice input.'),
                'error',
                3200,
            );
        }
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

    private _onError(error: { code: string; message?: string }): void {
        if (this._shouldOpenWindowsSpeechSettings(error)) {
            this._showToast(
                this._i18n.t(
                    'ui.chat.voice.open_speech_settings',
                    'Windows speech privacy is disabled. Click to open Speech settings.',
                ),
                'warning',
                9000,
                null,
                'voice-privacy-settings',
                () => {
                    void this._openVoiceSettings().catch(() => {
                        this._showToast(
                            this._i18n.t(
                                'ui.chat.voice.open_settings_failed',
                                'Open Windows Settings > Privacy & security > Speech and enable Online speech recognition.',
                            ),
                            'warning',
                            5200,
                        );
                    });
                },
            );
            return;
        }

        const trimmedMessage = error.message?.trim();
        const fallback =
            trimmedMessage !== undefined && trimmedMessage !== ''
                ? trimmedMessage
                : this._i18n.t('ui.chat.voice.failed', 'Voice recognition failed.');

        this._showToast(fallback, error.code === 'PERMISSION_DENIED' ? 'warning' : 'error', 4200);
    }

    private _shouldOpenWindowsSpeechSettings(error: { code: string; message?: string }): boolean {
        return (
            error.code === 'PERMISSION_DENIED' &&
            (error.message ?? '').toLowerCase().includes('speech privacy')
        );
    }
}
