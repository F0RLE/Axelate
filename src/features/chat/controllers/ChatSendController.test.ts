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
            handleResponse: vi.fn().mockResolvedValue(undefined),
            cleanupStreamingState: vi.fn(),
            stopImagePreviewPolling: vi.fn(),
            startImagePreviewPolling: vi.fn(),
            cancelTextGeneration: vi.fn().mockResolvedValue(true),
            isImageProvider: vi.fn(() => false),
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
            sendMessage,
        };
    };

    beforeEach(() => {
        vi.clearAllMocks();
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
});
