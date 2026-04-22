/**
 * VoiceInputService Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceInputService } from '@/features/chat/services/VoiceInputService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

interface MockSpeechRecognitionInstance {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onstart: (() => void) | null;
    onresult:
        | ((e: {
              resultIndex: number;
              results: Array<{ isFinal: boolean; length: number; 0: { transcript: string } }>;
          }) => void)
        | null;
    onend: (() => void) | null;
    onerror: ((e: { error: string }) => void) | null;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
}

/** Creates a mock SpeechRecognition instance for testing */
function makeMockSpeech(): MockSpeechRecognitionInstance {
    return {
        lang: '',
        continuous: false,
        interimResults: false,
        onstart: null,
        onresult: null,
        onend: null,
        onerror: null,
        start: vi.fn(),
        stop: vi.fn(),
    };
}

describe('VoiceInputService', () => {
    let service: VoiceInputService;
    let tracer: Pick<LoggerService, 'info' | 'error'>;

    beforeEach(() => {
        tracer = {
            info: vi.fn(),
            error: vi.fn(),
        };
        service = new VoiceInputService(tracer);
    });

    describe('isSupported', () => {
        it('should return false when SpeechRecognition is not available', () => {
            // Default test environment doesn't have SpeechRecognition
            expect(service.isSupported()).toBe(false);
        });

        it('should return true when webkitSpeechRecognition is available', () => {
            // Mock the API
            const win = globalThis as unknown as Record<string, unknown>;
            win['webkitSpeechRecognition'] = class MockSpeechRecognition {
                start() {
                    /* mock start */
                }
                stop() {
                    /* mock stop */
                }
            };
            const newService = new VoiceInputService(tracer);
            expect(newService.isSupported()).toBe(true);
            delete win['webkitSpeechRecognition'];
        });
    });

    describe('isActive', () => {
        it('should return false initially', () => {
            expect(service.isActive()).toBe(false);
        });
    });

    describe('start', () => {
        it('should return false when speech recognition is not supported', () => {
            const onResult = vi.fn();
            const result = service.start(onResult);
            expect(result).toBe(false);
            expect(onResult).not.toHaveBeenCalled();
        });
    });

    describe('stop', () => {
        it('should not throw when called without active recording', () => {
            expect(() => {
                service.stop();
            }).not.toThrow();
            expect(service.isActive()).toBe(false);
        });
    });

    describe('start with SpeechRecognition support', () => {
        beforeEach(() => {
            (globalThis as unknown as Record<string, unknown>)['webkitSpeechRecognition'] =
                vi.fn(makeMockSpeech);
            service = new VoiceInputService(tracer);
        });

        afterEach(() => {
            service.stop();
            delete (globalThis as unknown as Record<string, unknown>)['webkitSpeechRecognition'];
        });

        /** Returns the internal recognition object after start() */
        const recog = (): MockSpeechRecognitionInstance =>
            (service as unknown as { _recognition: MockSpeechRecognitionInstance })._recognition;

        it('should start recording successfully', () => {
            const result = service.start(vi.fn(), { onStateChange: vi.fn() });
            expect(result).toBe(true);
            expect(service.isActive()).toBe(true);
            expect(recog().start).toHaveBeenCalled();
        });

        it('should stop and return false when already recording', () => {
            service.start(vi.fn());
            const result = service.start(vi.fn());
            expect(result).toBe(false);
        });

        it('should fire onstart handler', () => {
            const onState = vi.fn();
            service.start(vi.fn(), { onStateChange: onState });
            recog().onstart?.();
            expect(onState).toHaveBeenNthCalledWith(1, {
                state: 'starting',
                isRecording: true,
            });
            expect(onState).toHaveBeenNthCalledWith(2, {
                state: 'listening',
                isRecording: true,
            });
        });

        it('should fire onresult handler with final text', () => {
            const onResult = vi.fn();
            service.start(onResult);
            recog().onresult?.({
                resultIndex: 0,
                results: [
                    {
                        isFinal: true,
                        0: { transcript: 'Hello world' },
                        length: 1,
                    },
                ],
            });
            expect(onResult).toHaveBeenCalledWith('Hello world');
        });

        it('should ignore non-final results', () => {
            const onResult = vi.fn();
            service.start(onResult);
            recog().onresult?.({
                resultIndex: 0,
                results: [
                    {
                        isFinal: false,
                        0: { transcript: 'partial' },
                        length: 1,
                    },
                ],
            });
            expect(onResult).not.toHaveBeenCalled();
        });

        it('should fire onend handler and stop', () => {
            const onState = vi.fn();
            service.start(vi.fn(), { onStateChange: onState });
            recog().onend?.();
            expect(service.isActive()).toBe(false);
            expect(onState).toHaveBeenLastCalledWith({
                state: 'idle',
                isRecording: false,
                reason: 'ended',
            });
        });

        it('should fire onerror handler and stop', () => {
            const onState = vi.fn();
            const onError = vi.fn();
            service.start(vi.fn(), { onStateChange: onState, onError });
            recog().onerror?.({ error: 'network' });
            recog().onend?.();
            expect(service.isActive()).toBe(false);
            expect(onError).toHaveBeenCalledWith({ code: 'network', message: undefined });
            expect(onState).toHaveBeenLastCalledWith({
                state: 'idle',
                isRecording: false,
                reason: 'error',
            });
        });

        it('should handle onend safely after state is already idle', () => {
            service.start(vi.fn());
            (service as unknown as { _state: 'idle' })._state = 'idle';
            recog().onend?.();
            expect(service.isActive()).toBe(false);
        });

        it('should handle onerror safely after state is already idle', () => {
            service.start(vi.fn());
            (service as unknown as { _state: 'idle' })._state = 'idle';
            recog().onerror?.({ error: 'aborted' });
            recog().onend?.();
            expect(service.isActive()).toBe(false);
        });

        it('should handle recognition.start() throwing', () => {
            (globalThis as unknown as Record<string, unknown>)['webkitSpeechRecognition'] = vi.fn(
                () => ({
                    lang: '',
                    continuous: false,
                    interimResults: false,
                    start: vi.fn(() => {
                        throw new Error('Start fail');
                    }),
                    stop: vi.fn(),
                }),
            );
            service = new VoiceInputService(tracer);
            const result = service.start(vi.fn());
            expect(result).toBe(false);
        });

        it('should emit startup failure through structured callbacks', () => {
            const onState = vi.fn();
            const onError = vi.fn();

            (globalThis as unknown as Record<string, unknown>)['webkitSpeechRecognition'] = class {
                public lang = '';
                public continuous = false;
                public interimResults = false;
                public onstart = null;
                public onresult = null;
                public onend = null;
                public onerror = null;
                public start() {
                    throw new Error('Start fail');
                }
                public stop() {
                    /* no-op */
                }
            } as unknown as new () => MockSpeechRecognitionInstance;
            service = new VoiceInputService(tracer);

            const result = service.start(vi.fn(), { onStateChange: onState, onError });

            expect(result).toBe(false);
            expect(onState).toHaveBeenNthCalledWith(1, {
                state: 'starting',
                isRecording: true,
            });
            expect(onState).toHaveBeenNthCalledWith(2, {
                state: 'idle',
                isRecording: false,
                reason: 'startup_failed',
            });
            expect(onError).toHaveBeenCalledWith({
                code: 'startup_failed',
                message: 'Error: Start fail',
            });
        });

        it('should set language from currentLang', () => {
            document.documentElement.lang = 'ru';
            service.start(vi.fn());
            expect(recog().lang).toBe('ru-RU');
        });

        it('should fallback to raw lang for unknown language (L67)', () => {
            document.documentElement.lang = 'fr';
            service.start(vi.fn());
            expect(recog().lang).toBe('fr');
        });

        it('should use SpeechRecognition when webkitSpeechRecognition is absent (L55)', () => {
            delete (globalThis as unknown as Record<string, unknown>)['webkitSpeechRecognition'];
            (globalThis as unknown as Record<string, unknown>)['SpeechRecognition'] =
                vi.fn(makeMockSpeech);
            service = new VoiceInputService(tracer);

            const result = service.start(vi.fn());
            expect(result).toBe(true);

            delete (globalThis as unknown as Record<string, unknown>)['SpeechRecognition'];
            (globalThis as unknown as Record<string, unknown>)['webkitSpeechRecognition'] =
                vi.fn(makeMockSpeech);
        });

        it('should not emit result when first transcript is missing (L85)', () => {
            const onResult = vi.fn();
            service.start(onResult);
            recog().onresult?.({
                resultIndex: 0,
                results: [
                    {
                        isFinal: true,
                        0: undefined as unknown as { transcript: string },
                        length: 1,
                    },
                ],
            });
            expect(onResult).not.toHaveBeenCalled();
        });

        it('should stop active recognition gracefully', () => {
            const onState = vi.fn();
            service.start(vi.fn(), { onStateChange: onState });
            const r = recog();
            service.stop();
            r.onend?.();
            expect(r.stop).toHaveBeenCalled();
            expect(service.isActive()).toBe(false);
            expect(onState).toHaveBeenNthCalledWith(2, {
                state: 'stopping',
                isRecording: true,
            });
            expect(onState).toHaveBeenLastCalledWith({
                state: 'idle',
                isRecording: false,
                reason: 'user',
            });
        });

        it('should handle recognition.stop() throwing', () => {
            service.start(vi.fn());
            recog().stop.mockImplementation(() => {
                throw new Error('Stop error');
            });
            expect(() => service.stop()).not.toThrow();
        });
    });
});
