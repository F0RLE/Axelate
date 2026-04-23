import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatSendController } from './ChatSendController';

describe('ChatSendController', () => {
    const createController = () => {
        const streamingHandle = {
            update: vi.fn(),
            replace: vi.fn(),
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
        const options = {
            aiBridge: aiBridge as never,
            fileHandler: {
                hasFiles: vi.fn(() => false),
                getTotalTokenEstimate: vi.fn(() => Promise.resolve(0)),
                processForSend: vi.fn((text: string) =>
                    Promise.resolve({
                        attachments: [],
                        combinedText: text,
                    }),
                ),
            } as never,
            service: {
                sendMessage: vi.fn().mockResolvedValue({ ok: true, message: 'done' }),
            } as never,
            getHistory: vi.fn(() => []),
            pushUserMessage: vi.fn(),
            createStreamingHandle: vi.fn(() => streamingHandle),
            createImageHandle: vi.fn(() => imageHandle),
            showTyping: vi.fn(),
            registerReplaceChunk: vi.fn(),
            clearInput: vi.fn(),
            updateTokenCount: vi.fn(),
            appendUserMessage: vi.fn(),
            getSelectedModule: vi.fn(),
            getPreferredAiCategory: vi.fn(() => 'ai_text' as const),
            handleResponse: vi.fn().mockResolvedValue(undefined),
            cleanupStreamingState: vi.fn(),
            stopImagePreviewPolling: vi.fn(),
            startImagePreviewPolling: vi.fn(),
            restoreInputText: vi.fn(),
            isImageProvider: vi.fn(() => false),
            lockUi: vi.fn(() => ({
                input: null,
                sendBtn: null,
                voiceBtn: null,
                attachBtn: null,
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
        };
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates a streaming handle immediately for text responses', async () => {
        const { controller, options, aiBridge, streamingHandle } = createController();
        const input = document.createElement('textarea');
        input.value = 'hello';

        const result = await controller.sendChat(input);

        expect(result).toBe(true);
        expect(options.handleError).not.toHaveBeenCalled();
        expect(options.createStreamingHandle).toHaveBeenCalledOnce();
        expect(options.showTyping).not.toHaveBeenCalled();
        expect(aiBridge.onChunk).toHaveBeenCalledOnce();

        const onChunkHandler = aiBridge.onChunk.mock.calls[0]?.[1] as
            | ((chunk: string) => void)
            | undefined;
        onChunkHandler?.('hi');

        expect(streamingHandle.update).toHaveBeenCalledWith('hi');
    });
});
