import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGenerationController } from './ChatGenerationController';
import { CUSTOM_IMAGE_PROVIDER_ID } from '@/shared/utils/customProviderSupport';

describe('ChatGenerationController', () => {
    const aiBridge = {
        getImageGenerationPreview: vi.fn(),
        removeChunkListener: vi.fn(),
        removeReplaceChunkListener: vi.fn(),
    };

    const baseOptions = {
        aiBridge,
        i18n: {
            t: vi.fn((_: string, fallback: string) => fallback),
        },
        removeTyping: vi.fn(),
        appendAssistantMessage: vi.fn(),
        pushAssistantMessage: vi.fn(),
        extractText: vi.fn((value: unknown) => String(value ?? '')),
        buildGeneratedImageContent: vi.fn(),
        estimateReplyTokens: vi.fn().mockResolvedValue(0),
        addContextTokens: vi.fn(),
        getFriendlyErrorMessage: vi.fn(),
        handleError: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
        isSending: vi.fn().mockReturnValue(true),
        tracer: {
            debug: vi.fn(),
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should schedule the next preview poll only after the current one finishes', async () => {
        vi.useFakeTimers();

        let resolvePreview:
            | ((value: { data_url: string; updated_at_ms: number }) => void)
            | undefined;
        aiBridge.getImageGenerationPreview.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolvePreview = resolve;
                }),
        );

        const controller = new ChatGenerationController(baseOptions as never);
        const handle = {
            setStatus: vi.fn(),
            setPreview: vi.fn(),
            finalize: vi.fn(),
            fail: vi.fn(),
            cancel: vi.fn(),
            discard: vi.fn(),
        };

        controller.startImagePreviewPolling(handle);
        await vi.advanceTimersByTimeAsync(0);
        expect(aiBridge.getImageGenerationPreview).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(5000);
        expect(aiBridge.getImageGenerationPreview).toHaveBeenCalledTimes(1);

        resolvePreview?.({ data_url: 'data:image/png;base64,abc', updated_at_ms: 1 });
        await Promise.resolve();

        expect(handle.setPreview).toHaveBeenCalledWith('data:image/png;base64,abc');

        await vi.advanceTimersByTimeAsync(849);
        expect(aiBridge.getImageGenerationPreview).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        expect(aiBridge.getImageGenerationPreview).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
    });

    it('should keep image generation visibly active when preview progress is unavailable', async () => {
        vi.useFakeTimers();
        aiBridge.getImageGenerationPreview.mockResolvedValue(null);
        const controller = new ChatGenerationController(baseOptions as never);
        const handle = {
            setStatus: vi.fn(),
            setPreview: vi.fn(),
            finalize: vi.fn(),
            fail: vi.fn(),
            cancel: vi.fn(),
            discard: vi.fn(),
        };

        controller.startImagePreviewPolling(handle);
        await vi.advanceTimersByTimeAsync(0);

        expect(handle.setStatus).toHaveBeenCalledWith('image status=running elapsed=0s');

        await vi.advanceTimersByTimeAsync(1000);
        expect(handle.setStatus).toHaveBeenLastCalledWith('image status=running elapsed=1s');

        controller.stopImagePreviewPolling();
        vi.useRealTimers();
    });

    it('should prefer concrete preview progress over heartbeat ticks', async () => {
        vi.useFakeTimers();
        aiBridge.getImageGenerationPreview.mockResolvedValue({
            data_url: '',
            updated_at_ms: 0,
            progress: 0.5,
        });
        const controller = new ChatGenerationController(baseOptions as never);
        const handle = {
            setStatus: vi.fn(),
            setPreview: vi.fn(),
            finalize: vi.fn(),
            fail: vi.fn(),
            cancel: vi.fn(),
            discard: vi.fn(),
        };

        controller.startImagePreviewPolling(handle);
        await vi.advanceTimersByTimeAsync(0);

        expect(handle.setStatus).toHaveBeenCalledWith('image status=running percent=50');
        handle.setStatus.mockClear();

        await vi.advanceTimersByTimeAsync(1000);
        expect(handle.setStatus).not.toHaveBeenCalledWith(expect.stringContaining('elapsed='));

        controller.stopImagePreviewPolling();
        vi.useRealTimers();
    });

    it('should include log-derived sdcpp steps and speed from preview polling', async () => {
        vi.useFakeTimers();
        aiBridge.getImageGenerationPreview.mockResolvedValue({
            data_url: '',
            updated_at_ms: 0,
            progress: 0.2,
            step: 6,
            total: 30,
            speed: '140.70s/it',
        });
        const controller = new ChatGenerationController(baseOptions as never);
        const handle = {
            setStatus: vi.fn(),
            setPreview: vi.fn(),
            finalize: vi.fn(),
            fail: vi.fn(),
            cancel: vi.fn(),
            discard: vi.fn(),
        };

        controller.startImagePreviewPolling(handle);
        await vi.advanceTimersByTimeAsync(0);

        expect(handle.setStatus).toHaveBeenCalledWith(
            'image status=running percent=20 step=6 total=30 speed=140.70s/it',
        );

        controller.stopImagePreviewPolling();
        vi.useRealTimers();
    });

    it('treats cloud and custom image providers as image flows', () => {
        const controller = new ChatGenerationController(baseOptions as never);

        expect(controller.isImageProvider('gpt-image')).toBe(true);
        expect(controller.isImageProvider('seedream-image')).toBe(true);
        expect(controller.isImageProvider(CUSTOM_IMAGE_PROVIDER_ID)).toBe(true);
        expect(controller.isImageProvider('gpt')).toBe(false);
        expect(controller.isImageProvider(null)).toBe(false);
    });

    it('discards partial streaming output when the backend returns an error', async () => {
        const controller = new ChatGenerationController(baseOptions as never);
        const streamingHandle = {
            update: vi.fn(),
            replace: vi.fn(),
            discard: vi.fn(),
            finalize: vi.fn(),
        };

        await controller.handleChatResponse(
            { ok: false, error: 'stream failed', model: 'gpt-5.5' } as never,
            streamingHandle,
            null,
        );

        expect(streamingHandle.discard).toHaveBeenCalledTimes(1);
        expect(baseOptions.handleError).toHaveBeenCalled();
    });

    it('adds assistant text tokens to the context counter', async () => {
        baseOptions.estimateReplyTokens.mockResolvedValueOnce(7);
        const controller = new ChatGenerationController(baseOptions as never);

        await controller.handleChatResponse({ ok: true, message: 'answer' } as never, null, null);

        expect(baseOptions.addContextTokens).toHaveBeenCalledWith(7);
    });

    it('adds generated image tokens to the context counter', async () => {
        baseOptions.estimateReplyTokens.mockResolvedValueOnce(3);
        const controller = new ChatGenerationController(baseOptions as never);

        await controller.handleChatResponse(
            {
                ok: true,
                reply: {
                    text: 'caption',
                    images: [{ mime: 'image/png', data_base64: 'ZmFrZQ==' }],
                },
            } as never,
            null,
            null,
        );

        expect(baseOptions.addContextTokens).toHaveBeenCalledWith(261);
    });
});
