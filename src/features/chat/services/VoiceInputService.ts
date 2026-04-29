/**
 * @module chat/services/VoiceInputService
 * @description Handles native voice recognition through the host bridge.
 */

import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IBridge } from '@/shared/types/IBridge';

type VoiceInputLogger = Pick<LoggerService, 'info' | 'error'>;

type NativeVoiceResponse = {
    text: string;
    status: string;
    confidence?: string | null;
};

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
    private _state: VoiceRecordingState = 'idle';
    private _sessionId = 0;
    private _onStateChange: VoiceStateCallback | null = null;
    private _onError: VoiceErrorCallback | null = null;
    private _nativeRecognitionActive = false;

    public constructor(
        private readonly _tracer: VoiceInputLogger,
        private readonly _hostBridge: IBridge,
        private readonly _getCurrentLang: () => string = () =>
            document.documentElement.lang || 'en',
    ) {}

    /**
     * Native voice input is available only in the Tauri host.
     */
    public isSupported(): boolean {
        const capabilityBridge = this._hostBridge as IBridge & {
            hasCapability?: (capability: string) => boolean;
        };
        if (!this._hostBridge.isTauri()) {
            return false;
        }

        return capabilityBridge.hasCapability?.('speechRecognition') ?? false;
    }

    /**
     * Check if a native voice request is currently active.
     */
    public isActive(): boolean {
        return this._state !== 'idle';
    }

    /**
     * Starts one native voice recognition request.
     */
    public start(onResult: VoiceResultCallback, callbacks: VoiceSessionCallbacks = {}): boolean {
        if (this.isActive() || this._nativeRecognitionActive) {
            this.stop();
            return false;
        }

        if (!this.isSupported()) {
            return false;
        }

        const sessionId = ++this._sessionId;
        this._onStateChange = callbacks.onStateChange ?? null;
        this._onError = callbacks.onError ?? null;
        this._nativeRecognitionActive = true;
        this._setState('starting');
        this._setState('listening');

        void this._recognize(sessionId, onResult);
        return true;
    }

    /**
     * Stops the current frontend session and ignores the pending native result.
     */
    public stop(): void {
        if (!this.isActive() && !this._nativeRecognitionActive) {
            return;
        }

        this._sessionId += 1;
        this._nativeRecognitionActive = false;
        if (this.isActive()) {
            this._setState('stopping');
        }
        this._finishSession('user');
    }

    private async _recognize(sessionId: number, onResult: VoiceResultCallback): Promise<void> {
        try {
            const language = this._getCurrentLang();
            this._tracer.info(`[VoiceInputService] Native recognition language: ${language}`);
            const response = await this._hostBridge.invoke<NativeVoiceResponse>(
                'recognize_voice_once',
                {
                    request: { language },
                },
            );

            if (this._sessionId !== sessionId) {
                return;
            }

            const text = response.text.trim();
            if (text.length > 0) {
                try {
                    onResult(text);
                } catch (err) {
                    this._tracer.error(
                        `[VoiceInputService] onResult handler threw: ${String(err)}`,
                    );
                }
            }
            this._finishSession('ended');
        } catch (error) {
            if (this._sessionId !== sessionId) {
                return;
            }

            const payload = this._toErrorPayload(error);
            this._tracer.error(`[VoiceInputService] Native recognition error: ${payload.message}`);
            this._onError?.(payload);
            this._finishSession(payload.code === 'startup_failed' ? 'startup_failed' : 'error');
        } finally {
            if (this._sessionId === sessionId) {
                this._nativeRecognitionActive = false;
            }
        }
    }

    private _finishSession(reason: VoiceStopReason): void {
        this._setState('idle', reason);
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

    private _toErrorPayload(error: unknown): { code: string; message?: string } {
        if (error instanceof Error) {
            return {
                code: this._getErrorCode(error),
                message: error.message,
            };
        }

        if (typeof error === 'object' && error !== null) {
            const record = error as Record<string, unknown>;
            const message =
                typeof record['message'] === 'string' ? record['message'] : String(error);
            const code = typeof record['code'] === 'string' ? record['code'] : 'recognition_failed';
            return { code, message };
        }

        return {
            code: 'recognition_failed',
            message: String(error),
        };
    }

    private _getErrorCode(error: Error): string {
        const withCode = error as Error & { code?: unknown };
        return typeof withCode.code === 'string' ? withCode.code : 'recognition_failed';
    }
}
