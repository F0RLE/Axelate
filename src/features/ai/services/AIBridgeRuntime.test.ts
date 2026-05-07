import { describe, expect, it, vi } from 'vitest';

import { buildImageGenerationProgressChunk, isActiveEngineLog } from './AIBridgeRuntime';
import { AIBridgeRuntime } from './AIBridgeRuntime';

describe('AIBridgeRuntime', () => {
    it('normalizes image progress logs into machine-readable chunks', () => {
        expect(buildImageGenerationProgressChunk('  8/20 40% 1.25it/s')).toBe(
            'image status=running percent=40 step=8 total=20 speed=1.25it/s\n',
        );
    });

    it('normalizes real sd.cpp progress bar logs', () => {
        expect(
            buildImageGenerationProgressChunk(
                '2026-04-26 13:55:26 [INFO] |==============> | 8/28 - 1.03it/s',
            ),
        ).toBe('image status=running percent=29 step=8 total=28 speed=1.03it/s\n');
        expect(buildImageGenerationProgressChunk('|=> | 1/28 - 1.07s/it')).toBe(
            'image status=running percent=4 step=1 total=28 speed=1.07s/it\n',
        );
        expect(buildImageGenerationProgressChunk('|=> | 1/30 - 1.07s/it')).toBe(
            'image status=running percent=3 step=1 total=30 speed=1.07s/it\n',
        );
    });

    it('detects image generation state logs without progress values', () => {
        expect(buildImageGenerationProgressChunk('generating image')).toBe(
            'image status=running\n',
        );
    });

    it('ignores unrelated engine logs', () => {
        expect(buildImageGenerationProgressChunk('server ready')).toBeNull();
    });

    it('accepts selected image engine logs for image progress regardless of active text provider', () => {
        expect(isActiveEngineLog('custom_text', 'local-image-engine', 'local-image-engine')).toBe(
            true,
        );
        expect(isActiveEngineLog(null, 'local-image-engine', 'local-image-engine')).toBe(true);
        expect(isActiveEngineLog(null, 'local-image-engine', null)).toBe(false);
        expect(isActiveEngineLog('llamacpp', 'llamacpp')).toBe(true);
        expect(isActiveEngineLog('llamacpp', 'other')).toBe(false);
    });

    it('cleans up partial stream subscriptions when initialization fails', async () => {
        const cleanupLog = vi.fn();
        const runtime = new AIBridgeRuntime({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        });
        const failure = new Error('stream subscription failed');

        await expect(
            runtime.initializeStreaming({
                context: {
                    tauriProvider: {
                        isTauri: () => true,
                        listen: vi.fn().mockResolvedValue(cleanupLog),
                    },
                },
                transport: {
                    onStream: vi.fn(() => {
                        throw failure;
                    }),
                    onThought: vi.fn(),
                },
                events: {
                    broadcastReplaceChunk: vi.fn(),
                },
                getActiveProviderId: () => null,
                broadcastChunk: vi.fn(),
                broadcastThought: vi.fn(),
            } as never),
        ).rejects.toBe(failure);

        expect(cleanupLog).toHaveBeenCalledTimes(1);
    });
});
