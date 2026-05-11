/**
 * VoiceInputService Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceInputService } from '@/features/chat/services/VoiceInputService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IBridge } from '@/shared/types/IBridge';

type NativeVoiceResponse = {
    text: string;
    status: string;
    confidence?: string | null;
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
}

describe('VoiceInputService', () => {
    let tracer: Pick<LoggerService, 'info' | 'error'>;
    let bridge: IBridge;
    let invokeMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        document.body.dataset['platform'] = 'windows';
        tracer = {
            info: vi.fn(),
            error: vi.fn(),
        };
        invokeMock = vi.fn();
        bridge = {
            invoke: async <T, A extends Record<string, unknown> = Record<string, unknown>>(
                cmd: string,
                args?: A,
            ) => {
                const callInvokeMock = invokeMock as unknown as (
                    cmd: string,
                    args?: Record<string, unknown>,
                ) => Promise<unknown>;
                return (await callInvokeMock(cmd, args)) as T;
            },
            listen: vi.fn(),
            isTauri: vi.fn(() => true),
        };
    });

    const createService = (getLang: () => string = () => 'en') =>
        new VoiceInputService(tracer, bridge, getLang);

    it('is unsupported outside the Tauri host', () => {
        vi.mocked(bridge.isTauri).mockReturnValue(false);
        const service = createService();

        expect(service.isSupported()).toBe(false);
        expect(service.start(vi.fn())).toBe(false);
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('starts native recognition and emits trimmed text', async () => {
        const pending = deferred<NativeVoiceResponse>();
        invokeMock.mockReturnValue(pending.promise);
        const service = createService(() => 'ru');
        const onResult = vi.fn();
        const onState = vi.fn();

        expect(service.start(onResult, { onStateChange: onState })).toBe(true);
        expect(service.isActive()).toBe(true);
        expect(invokeMock).toHaveBeenCalledWith('recognize_voice_once', {
            request: { language: 'ru' },
        });
        expect(onState).toHaveBeenNthCalledWith(1, {
            state: 'starting',
            isRecording: true,
        });
        expect(onState).toHaveBeenNthCalledWith(2, {
            state: 'listening',
            isRecording: true,
        });

        pending.resolve({ text: ' hello world ', status: 'success', confidence: 'high' });
        await pending.promise;
        await Promise.resolve();

        expect(onResult).toHaveBeenCalledWith('hello world');
        expect(service.isActive()).toBe(false);
        expect(onState).toHaveBeenLastCalledWith({
            state: 'idle',
            isRecording: false,
            reason: 'ended',
        });
    });

    it('does not emit empty recognition results', async () => {
        invokeMock.mockResolvedValue({ text: '   ', status: 'success', confidence: null });
        const service = createService();
        const onResult = vi.fn();

        service.start(onResult);
        await Promise.resolve();
        await Promise.resolve();

        expect(onResult).not.toHaveBeenCalled();
        expect(service.isActive()).toBe(false);
    });

    it('stops the current session and ignores the late native result', async () => {
        const pending = deferred<NativeVoiceResponse>();
        invokeMock.mockReturnValue(pending.promise);
        const service = createService();
        const onResult = vi.fn();
        const onState = vi.fn();

        service.start(onResult, { onStateChange: onState });
        service.stop();
        pending.resolve({ text: 'late text', status: 'success' });
        await pending.promise;
        await Promise.resolve();

        expect(onResult).not.toHaveBeenCalled();
        expect(service.isActive()).toBe(false);
        expect(onState).toHaveBeenLastCalledWith({
            state: 'idle',
            isRecording: false,
            reason: 'user',
        });
    });

    it('stops existing session when start is called twice', () => {
        invokeMock.mockReturnValue(new Promise(() => undefined));
        const service = createService();

        expect(service.start(vi.fn())).toBe(true);
        expect(service.start(vi.fn())).toBe(false);
        expect(service.isActive()).toBe(false);
    });

    it('emits structured native errors', async () => {
        const error = new Error('Microphone is unavailable');
        Object.defineProperty(error, 'code', { value: 'PERMISSION_DENIED' });
        invokeMock.mockRejectedValue(error);
        const service = createService();
        const onError = vi.fn();
        const onState = vi.fn();

        service.start(vi.fn(), { onError, onStateChange: onState });
        await Promise.resolve();
        await Promise.resolve();

        expect(onError).toHaveBeenCalledWith({
            code: 'PERMISSION_DENIED',
            message: 'Microphone is unavailable',
        });
        expect(onState).toHaveBeenLastCalledWith({
            state: 'idle',
            isRecording: false,
            reason: 'error',
        });
    });

    it('does not throw when stopped while idle', () => {
        const service = createService();

        expect(() => service.stop()).not.toThrow();
        expect(service.isActive()).toBe(false);
    });
});
