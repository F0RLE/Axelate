/**
 * VoiceInputService Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceInputService } from '@/features/chat/services/VoiceInputService';

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

    beforeEach(() => {
        service = new VoiceInputService();
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
            const newService = new VoiceInputService();
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
            service = new VoiceInputService();
        });

        afterEach(() => {
            service.stop();
            delete (globalThis as unknown as Record<string, unknown>)['webkitSpeechRecognition'];
        });

        /** Returns the internal recognition object after start() */
        const recog = (): MockSpeechRecognitionInstance =>
            (service as unknown as { _recognition: MockSpeechRecognitionInstance })._recognition;

        it('should start recording successfully', () => {
            const result = service.start(vi.fn(), vi.fn());
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
            service.start(vi.fn(), onState);
            recog().onstart?.();
            expect(onState).toHaveBeenCalledWith(true);
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
            service.start(vi.fn());
            recog().onend?.();
            expect(service.isActive()).toBe(false);
        });

        it('should fire onerror handler and stop', () => {
            service.start(vi.fn());
            recog().onerror?.({ error: 'network' });
            expect(service.isActive()).toBe(false);
        });

        it('should not call stop in onend when already stopped (L94)', () => {
            service.start(vi.fn());
            // Manually set _isRecording to false to simulate already-stopped state
            (service as unknown as { _isRecording: boolean })._isRecording = false;
            recog().onend?.();
            // Should not throw or change state
            expect(service.isActive()).toBe(false);
        });

        it('should not call stop in onerror when already stopped (L101)', () => {
            service.start(vi.fn());
            (service as unknown as { _isRecording: boolean })._isRecording = false;
            recog().onerror?.({ error: 'aborted' });
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
            service = new VoiceInputService();
            const result = service.start(vi.fn());
            expect(result).toBe(false);
        });

        it('should set language from currentLang', () => {
            (globalThis as unknown as Record<string, unknown>)['currentLang'] = 'ru';
            service.start(vi.fn());
            expect(recog().lang).toBe('ru-RU');
            delete (globalThis as unknown as Record<string, unknown>)['currentLang'];
        });

        it('should fallback to raw lang for unknown language (L67)', () => {
            (globalThis as unknown as Record<string, unknown>)['currentLang'] = 'fr';
            service.start(vi.fn());
            expect(recog().lang).toBe('fr');
            delete (globalThis as unknown as Record<string, unknown>)['currentLang'];
        });

        it('should use SpeechRecognition when webkitSpeechRecognition is absent (L55)', () => {
            delete (globalThis as unknown as Record<string, unknown>)['webkitSpeechRecognition'];
            (globalThis as unknown as Record<string, unknown>)['SpeechRecognition'] =
                vi.fn(makeMockSpeech);
            service = new VoiceInputService();

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
            service.start(vi.fn());
            const r = recog();
            service.stop();
            expect(r.stop).toHaveBeenCalled();
            expect(service.isActive()).toBe(false);
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
