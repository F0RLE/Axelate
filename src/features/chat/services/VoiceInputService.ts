/**
 * @module chat/services/VoiceInputService
 * @description Handles speech recognition for chat input using the Web Speech API
 */

import type {
    ISpeechRecognitionEvent,
    ISpeechRecognitionErrorEvent,
    ISpeechRecognitionInstance,
} from '../types/chatTypes';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

type VoiceInputLogger = Pick<LoggerService, 'info' | 'error'>;

export type VoiceResultCallback = (text: string) => void;
export type VoiceRecordingState = 'idle' | 'starting' | 'listening' | 'stopping';
export type VoiceStopReason = 'user' | 'ended' | 'error' | 'startup_failed';
export type VoiceErrorCallback = (error: { code: string; message?: string }) => void;
export type VoiceStateCallback = (snapshot: {
    state: VoiceRecordingState;
    isRecording: boolean;
    reason?: VoiceStopReason;
}) => void;

type VoiceSessionCallbacks = {
    onStateChange?: VoiceStateCallback;
    onError?: VoiceErrorCallback;
};

export class VoiceInputService {
    private _recognition: ISpeechRecognitionInstance | null = null;
    private _state: VoiceRecordingState = 'idle';
    private _onResult: VoiceResultCallback | null = null;
    private _onStateChange: VoiceStateCallback | null = null;
    private _onError: VoiceErrorCallback | null = null;
    private readonly _getCurrentLang: () => string;
    private _pendingStopReason: VoiceStopReason | null = null;

    public constructor(
        private readonly _tracer: VoiceInputLogger,
        getCurrentLang: () => string = () => document.documentElement.lang || 'en',
    ) {
        this._getCurrentLang = getCurrentLang;
    }

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
        return this._state !== 'idle';
    }

    /**
     * Start voice recording
     */
    public start(
        onResult: VoiceResultCallback,
        callbacks: VoiceSessionCallbacks = {},
    ): boolean {
        if (this.isActive()) {
            this.stop();
            return false;
        }

        if (!this.isSupported()) {
            return false;
        }

        this._onResult = onResult;
        this._onStateChange = callbacks.onStateChange ?? null;
        this._onError = callbacks.onError ?? null;
        this._pendingStopReason = null;

        try {
            const win = globalThis as unknown as Record<string, unknown>;
            const SpeechRecognitionConstructor = (win['webkitSpeechRecognition'] ??
                win['SpeechRecognition']) as new () => ISpeechRecognitionInstance;
            const recognition = new SpeechRecognitionConstructor();
            this._recognition = recognition;

            // Set language with BCP-47 mapping
            const currentLang = this._getCurrentLang();
            const langMap: Record<string, string> = {
                en: 'en-US',
                ru: 'ru-RU',
                zh: 'zh-CN',
            };
            recognition.lang = langMap[currentLang] ?? currentLang;
            this._tracer.info(
                `[VoiceInputService] Target Recognition Lang: ${recognition.lang} (from: ${currentLang})`,
            );
            recognition.continuous = true;
            recognition.interimResults = true;

            recognition.onstart = () => {
                if (this._recognition !== recognition) {
                    return;
                }

                this._setState('listening');
            };

            recognition.onresult = (event: ISpeechRecognitionEvent) => {
                let finalText = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const result = event.results[i];
                    if (result?.isFinal === true) {
                        const first = result[0];
                        if (first) finalText += first.transcript;
                    }
                }
                if (finalText !== '' && this._onResult) {
                    this._onResult(finalText);
                }
            };

            recognition.onend = () => {
                if (this._recognition !== recognition) {
                    return;
                }

                this._finishSession(this._pendingStopReason ?? 'ended');
            };

            recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
                this._tracer.error(`[VoiceInputService] Recognition error: ${event.error}`);
                const payload: { code: string; message?: string } = {
                    code: event.error,
                };
                if (event.message !== undefined) {
                    payload.message = event.message;
                }
                this._onError?.(payload);
                this._requestStop('error');
            };

            this._setState('starting');
            recognition.start();

            return true;
        } catch (e) {
            this._tracer.error(`[VoiceInputService] Error starting recognition: ${String(e)}`);
            this._onError?.({
                code: 'startup_failed',
                message: String(e),
            });
            this._finishSession('startup_failed');
            return false;
        }
    }

    /**
     * Stop voice recording
     */
    public stop(): void {
        this._requestStop('user');
    }

    private _requestStop(reason: VoiceStopReason): void {
        this._pendingStopReason = reason;

        if (this._recognition === null) {
            this._finishSession(reason);
            return;
        }

        if (this._state !== 'stopping') {
            this._setState('stopping');
        }

        try {
            this._recognition.stop();
        } catch {
            this._finishSession(reason);
        }
    }

    private _finishSession(reason: VoiceStopReason): void {
        this._recognition = null;
        this._pendingStopReason = null;
        this._setState('idle', reason);
        this._onResult = null;
        this._onStateChange = null;
        this._onError = null;
    }

    private _setState(state: VoiceRecordingState, reason?: VoiceStopReason): void {
        const previousState = this._state;
        this._state = state;

        if (previousState === state && reason === undefined) {
            return;
        }

        const snapshot: {
            state: VoiceRecordingState;
            isRecording: boolean;
            reason?: VoiceStopReason;
        } = {
            state,
            isRecording: state === 'starting' || state === 'listening' || state === 'stopping',
        };
        if (reason !== undefined) {
            snapshot.reason = reason;
        }

        this._onStateChange?.(snapshot);
    }
}
