/**
 * @module chat/services/VoiceInputService
 * @description Handles speech recognition for chat input using the Web Speech API
 */

import type { ISpeechRecognitionEvent, ISpeechRecognitionInstance } from '../types/chatTypes';

export type VoiceResultCallback = (text: string) => void;
export type VoiceStateCallback = (isRecording: boolean) => void;

export class VoiceInputService {
    private _recognition: ISpeechRecognitionInstance | null = null;
    private _isRecording = false;
    private _onResult: VoiceResultCallback | null = null;
    private _onStateChange: VoiceStateCallback | null = null;

    /**
     * Check if voice input is supported in the current browser
     */
    public isSupported(): boolean {
        const win = globalThis as unknown as Record<string, unknown>;
        return 'webkitSpeechRecognition' in win || 'SpeechRecognition' in win;
    }

    /**
     * Check if currently recording
     */
    public isActive(): boolean {
        return this._isRecording;
    }

    /**
     * Start voice recording
     */
    public start(onResult: VoiceResultCallback, onStateChange?: VoiceStateCallback): boolean {
        if (this._isRecording) {
            this.stop();
            return false;
        }

        if (!this.isSupported()) {
            return false;
        }

        this._onResult = onResult;
        this._onStateChange = onStateChange || null;

        try {
            const win = globalThis as unknown as Record<string, unknown>;
            const SpeechRecognitionConstructor = (win.webkitSpeechRecognition ||
                win.SpeechRecognition) as new () => ISpeechRecognitionInstance;
            const recognition = new SpeechRecognitionConstructor();
            this._recognition = recognition;

            // Set language with BCP-47 mapping
            const currentLang = (win.currentLang as string) || 'en';
            const langMap: Record<string, string> = {
                en: 'en-US',
                ru: 'ru-RU',
                zh: 'zh-CN',
            };
            recognition.lang = langMap[currentLang] || currentLang || navigator.language || 'en-US';
            console.log(
                `[VoiceInputService] Target Recognition Lang: ${recognition.lang} (from: ${currentLang})`,
            );
            recognition.continuous = true;
            recognition.interimResults = true;

            recognition.onstart = () => {
                this._isRecording = true;
                this._onStateChange?.(true);
            };

            recognition.onresult = (event: ISpeechRecognitionEvent) => {
                let finalText = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalText += event.results[i][0].transcript;
                    }
                }
                if (finalText && this._onResult) {
                    this._onResult(finalText);
                }
            };

            recognition.onend = () => {
                if (this._isRecording) {
                    this.stop();
                }
            };

            recognition.start();
            return true;
        } catch (e) {
            console.error('[VoiceInputService] Error starting recognition:', e);
            this.stop();
            return false;
        }
    }

    /**
     * Stop voice recording
     */
    public stop(): void {
        this._isRecording = false;

        if (this._recognition) {
            try {
                this._recognition.stop();
            } catch {
                // Ignore stop errors
            }
            this._recognition = null;
        }

        this._onStateChange?.(false);
        this._onResult = null;
        this._onStateChange = null;
    }
}

// Export singleton
export const voiceInputService = new VoiceInputService();
