/**
 * VoiceInputService Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceInputService } from '../modules/chat/services/VoiceInputService';

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
            expect(() => service.stop()).not.toThrow();
            expect(service.isActive()).toBe(false);
        });
    });
});
