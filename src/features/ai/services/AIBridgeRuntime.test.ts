import { describe, expect, it } from 'vitest';

import { buildImageGenerationProgressChunk, isActiveEngineLog } from './AIBridgeRuntime';

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

    it('accepts local image engine logs even when active provider alias differs', () => {
        expect(isActiveEngineLog('custom_sd', 'sdcpp')).toBe(true);
        expect(isActiveEngineLog(null, 'sdcpp')).toBe(true);
        expect(isActiveEngineLog('llamacpp', 'llamacpp')).toBe(true);
        expect(isActiveEngineLog('llamacpp', 'other')).toBe(false);
    });
});
