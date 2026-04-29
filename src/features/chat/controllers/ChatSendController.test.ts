import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatSendController } from './ChatSendController';

describe('ChatSendController', () => {
    const createController = () => {
        const streamingHandle = {
            setStatus: vi.fn(),
            update: vi.fn(),
            replace: vi.fn(),
            cancel: vi.fn(),
            discard: vi.fn(),
            finalize: vi.fn(),
        };
        const imageHandle = {
            setStatus: vi.fn(),
            setPreview: vi.fn(),
            finalize: vi.fn(),
            fail: vi.fn(),
            cancel: vi.fn(),
            discard: vi.fn(),
        };
        const aiBridge = {
            getState: vi.fn(() => ({ activeProviderId: 'gpt', isRunning: true })),
            onChunk: vi.fn(),
            startProvider: vi.fn().mockResolvedValue(true),
            prepareImagePrompt: vi.fn().mockResolvedValue({ ok: true, text: 'prepared prompt' }),
            stopEngineSlot: vi.fn().mockResolvedValue(undefined),
        };
        const sendMessage = vi.fn().mockResolvedValue({ ok: true, message: 'done' });
        const options = {
            aiBridge: aiBridge as never,
            fileHandler: {
                hasFiles: vi.fn(() => false),
                processForSend: vi.fn((text: string) =>
                    Promise.resolve({
                        attachments: [],
                        combinedText: text,
                    }),
                ),
            } as never,
            service: {
                sendMessage,
            } as never,
            getHistory: vi.fn(() => []),
            pushUserMessage: vi.fn(),
            createStreamingHandle: vi.fn(() => streamingHandle),
            createImageHandle: vi.fn(() => imageHandle),
            translate: vi.fn((key: string, fallback: string) => `t:${key}:${fallback}`),
            showTyping: vi.fn(),
            registerReplaceChunk: vi.fn(),
            clearInput: vi.fn(),
            addContextTokens: vi.fn(),
            appendUserMessage: vi.fn(),
            getSelectedModule: vi.fn(),
            getPreferredAiCategory: vi.fn(() => 'ai_text' as const),
            isForceImageGeneration: vi.fn(() => false),
            clearForceImageGeneration: vi.fn(),
            handleResponse: vi.fn().mockResolvedValue(undefined),
            cleanupStreamingState: vi.fn(),
            stopImagePreviewPolling: vi.fn(),
            startImagePreviewPolling: vi.fn(),
            cancelTextGeneration: vi.fn().mockResolvedValue(true),
            isImageProvider: vi.fn((_providerId: string | null) => false),
            lockUi: vi.fn(() => ({
                input: null,
                sendBtn: null,
                voiceBtn: null,
                attachBtn: null,
                contextBtn: null,
            })),
            unlockUi: vi.fn(),
            handleError: vi.fn(),
            isSending: vi.fn(() => false),
            setSending: vi.fn(),
            tracer: { info: vi.fn() },
        };

        return {
            controller: new ChatSendController(options),
            options,
            aiBridge,
            streamingHandle,
            imageHandle,
            sendMessage,
        };
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not send empty chat messages without attachments', async () => {
        const { controller, options, sendMessage } = createController();
        const input = document.createElement('textarea');
        input.value = '   ';

        const result = await controller.sendChat(input);

        expect(result).toBe(false);
        expect(options.lockUi).not.toHaveBeenCalled();
        expect(options.appendUserMessage).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('shows a pending response state until the first text chunk', async () => {
        const { controller, options, aiBridge, streamingHandle } = createController();
        const input = document.createElement('textarea');
        input.value = 'hello';

        const result = await controller.sendChat(input);

        expect(result).toBe(true);
        expect(options.handleError).not.toHaveBeenCalled();
        expect(options.createStreamingHandle).toHaveBeenCalledOnce();
        expect(streamingHandle.setStatus).toHaveBeenCalledWith('t:ui.chat.thinking:Thinking...');
        expect(options.showTyping).not.toHaveBeenCalled();
        expect(aiBridge.onChunk).toHaveBeenCalledOnce();

        const onChunkHandler = aiBridge.onChunk.mock.calls[0]?.[1] as
            | ((chunk: string) => void)
            | undefined;
        onChunkHandler?.('   ');

        onChunkHandler?.('hi');

        expect(options.createStreamingHandle).toHaveBeenCalledOnce();
        expect(streamingHandle.update).toHaveBeenCalledWith('hi');
    });

    it('cleans active stream listeners when destroyed during a send', async () => {
        let resolveSend: (value: { ok: true; message: string }) => void = () => {
            throw new Error('sendMessage promise was not started');
        };
        const { controller, options, sendMessage } = createController();
        sendMessage.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveSend = resolve;
                }),
        );
        const input = document.createElement('textarea');
        input.value = 'hello';

        const sendPromise = controller.sendChat(input);
        for (let index = 0; index < 10 && sendMessage.mock.calls.length === 0; index += 1) {
            await Promise.resolve();
        }

        expect(sendMessage).toHaveBeenCalledOnce();

        controller.destroy();

        expect(options.cleanupStreamingState).toHaveBeenCalledTimes(1);
        expect(options.stopImagePreviewPolling).toHaveBeenCalledTimes(1);
        expect(options.setSending).toHaveBeenLastCalledWith(false);

        resolveSend({ ok: true, message: 'done' });
        await sendPromise;

        expect(options.cleanupStreamingState).toHaveBeenCalledTimes(1);
        expect(options.handleResponse).not.toHaveBeenCalled();
    });

    it('cancels the active text request without rendering an error', async () => {
        let resolveSend: (value: { ok: false; error: string }) => void = () => {
            throw new Error('sendMessage promise was not started');
        };
        const { controller, options, sendMessage, streamingHandle } = createController();
        sendMessage.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveSend = resolve;
                }),
        );
        const input = document.createElement('textarea');
        input.value = 'hello';

        const sendPromise = controller.sendChat(input);
        for (let index = 0; index < 10 && sendMessage.mock.calls.length === 0; index += 1) {
            await Promise.resolve();
        }

        await controller.cancelActiveSend();
        resolveSend({ ok: false, error: 'AI request cancelled' });
        await sendPromise;

        expect(options.cancelTextGeneration).toHaveBeenCalledOnce();
        expect(streamingHandle.cancel).toHaveBeenCalledOnce();
        expect(options.handleResponse).not.toHaveBeenCalled();
        expect(options.handleError).not.toHaveBeenCalled();
    });

    it('stops the image engine after a successful image send', async () => {
        const { controller, options, aiBridge } = createController();
        aiBridge.getState.mockReturnValue({ activeProviderId: 'sdcpp', isRunning: true });
        options.isImageProvider.mockReturnValue(true);
        const input = document.createElement('textarea');
        input.value = 'draw image';

        await controller.sendChat(input);

        expect(options.startImagePreviewPolling).toHaveBeenCalledOnce();
        expect(options.handleResponse).toHaveBeenCalledOnce();
        expect(aiBridge.stopEngineSlot).toHaveBeenCalledWith('image');
    });

    it('stops the image engine after an image send throws', async () => {
        const { controller, options, aiBridge, sendMessage } = createController();
        aiBridge.getState.mockReturnValue({ activeProviderId: 'sdcpp', isRunning: true });
        options.isImageProvider.mockReturnValue(true);
        sendMessage.mockRejectedValueOnce(new Error('generation failed'));
        const input = document.createElement('textarea');
        input.value = 'draw image';

        await controller.sendChat(input);

        expect(options.handleError).toHaveBeenCalled();
        expect(aiBridge.stopEngineSlot).toHaveBeenCalledWith('image');
    });

    it('prepares image prompts with the selected text provider before local image generation', async () => {
        const { controller, options, aiBridge, sendMessage } = createController();
        aiBridge.getState
            .mockReturnValueOnce({ activeProviderId: 'sdcpp', isRunning: true })
            .mockReturnValueOnce({ activeProviderId: 'sdcpp', isRunning: true })
            .mockReturnValueOnce({ activeProviderId: 'text-model', isRunning: true })
            .mockReturnValue({ activeProviderId: 'sdcpp', isRunning: true });
        vi.mocked(options.isImageProvider).mockImplementation(
            (providerId: string | null) => providerId === 'sdcpp',
        );
        options.getSelectedModule.mockImplementation((category: 'ai_text' | 'ai_image') =>
            category === 'ai_text' ? { id: 'text-model' } : { id: 'sdcpp' },
        );
        aiBridge.prepareImagePrompt.mockResolvedValueOnce({
            ok: true,
            text: 'cinematic cat, rain, neon',
        });
        sendMessage.mockResolvedValueOnce({ ok: true, message: 'done' });
        const input = document.createElement('textarea');
        input.value = 'сгенерируй кота под дождем';

        await controller.sendChat(input);

        expect(aiBridge.startProvider).toHaveBeenNthCalledWith(1, 'text-model');
        expect(aiBridge.startProvider).toHaveBeenNthCalledWith(2, 'sdcpp');
        expect(aiBridge.prepareImagePrompt).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith('cinematic cat, rain, neon', [], [], {
            originalPrompt: 'сгенерируй кота под дождем',
        });
    });
});
