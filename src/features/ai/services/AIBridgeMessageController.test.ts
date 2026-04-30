import { describe, expect, it, vi } from 'vitest';

import { AIBridgeMessageController } from './AIBridgeMessageController';
import { AIBridgeProviderPolicy } from './AIBridgeProviderPolicy';
import {
    CUSTOM_IMAGE_PROVIDER_ID,
    CUSTOM_TEXT_PROVIDER_ID,
} from '@/shared/utils/customProviderSupport';

function createTextController() {
    const transport = {
        send: vi.fn().mockResolvedValue({ ok: true, text: 'done' }),
        sendSilent: vi.fn().mockResolvedValue({ ok: true, text: 'prepared' }),
        generateImage: vi.fn(),
    };
    const events = {
        broadcastResponse: vi.fn(),
        broadcastReplaceChunk: vi.fn(),
    };
    const manager: {
        activeProviderId: string | null;
        apiKey: string | null;
        model: string;
        sessionId: string;
        maxOutputTokens: number | undefined;
        refreshActiveApiKey: ReturnType<typeof vi.fn>;
        isActive: ReturnType<typeof vi.fn>;
    } = {
        activeProviderId: CUSTOM_TEXT_PROVIDER_ID,
        apiKey: '[secure]',
        model: 'deepseek/deepseek-r1-0528',
        sessionId: 'session-1',
        maxOutputTokens: 4096,
        refreshActiveApiKey: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn(() => true),
    };
    const context = {
        aiSettings: {
            getThinkingLevel: vi.fn(() => 'high'),
            getInternetAccessEnabled: vi.fn(() => false),
        },
        settingsService: {
            getSettings: vi.fn(() => ({})),
        },
        stateStore: {
            getSelectedModule: vi.fn(() => ({ id: CUSTOM_IMAGE_PROVIDER_ID })),
        },
        windowService: {
            close: vi.fn().mockResolvedValue(undefined),
        },
    };
    const showToast = vi.fn();
    const onActivity = vi.fn();

    const controller = new AIBridgeMessageController({
        getContext: () => context as never,
        transport: transport as never,
        manager: manager as never,
        events: events as never,
        providerPolicy: new AIBridgeProviderPolicy(),
        tracer: { error: vi.fn() },
        translate: (_key, fallback) => fallback,
        showToast,
        onActivity,
        onLongActivityStart: vi.fn(),
        onLongActivityEnd: vi.fn(),
        onSuccessfulResponse: vi.fn(),
    });

    return { controller, transport, events, manager, context, showToast, onActivity };
}

function createImageController() {
    const transport = {
        send: vi.fn(),
        sendSilent: vi.fn(),
        generateImage: vi
            .fn()
            .mockResolvedValue({ ok: true, images: ['data:image/png;base64,abc'] }),
    };
    const events = {
        broadcastResponse: vi.fn(),
        broadcastReplaceChunk: vi.fn(),
    };
    const manager = {
        activeProviderId: CUSTOM_IMAGE_PROVIDER_ID,
        apiKey: '[secure]',
        model: 'black-forest-labs/flux.2-max',
        sessionId: 'session-image',
        maxOutputTokens: undefined,
        refreshActiveApiKey: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn(() => true),
    };
    const context = {
        aiSettings: {
            getThinkingLevel: vi.fn(() => 'off'),
            getInternetAccessEnabled: vi.fn(() => false),
        },
        settingsService: {
            getSettings: vi.fn(() => ({})),
        },
        stateStore: {
            getSelectedModule: vi.fn(() => ({ id: CUSTOM_IMAGE_PROVIDER_ID })),
        },
        windowService: {
            close: vi.fn().mockResolvedValue(undefined),
        },
    };
    const onLongActivityStart = vi.fn();
    const onLongActivityEnd = vi.fn();

    const controller = new AIBridgeMessageController({
        getContext: () => context as never,
        transport: transport as never,
        manager: manager as never,
        events: events as never,
        providerPolicy: new AIBridgeProviderPolicy(),
        tracer: { error: vi.fn() },
        translate: (_key, fallback) => fallback,
        showToast: vi.fn(),
        onActivity: vi.fn(),
        onLongActivityStart,
        onLongActivityEnd,
        onSuccessfulResponse: vi.fn(),
    });

    return {
        controller,
        transport,
        events,
        manager,
        context,
        onLongActivityStart,
        onLongActivityEnd,
    };
}

describe('AIBridgeMessageController custom providers', () => {
    it('routes custom text providers through the text backend provider without changing model ids', async () => {
        const { controller, transport } = createTextController();

        await controller.sendMessage('Привет', 'chat', [], []);

        expect(transport.send).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'gpt',
                model: 'deepseek/deepseek-r1-0528',
                thinking_level: 'high',
            }),
        );
    });

    it('routes custom image providers through image generation and keeps raw model ids', async () => {
        const { controller, transport, events, onLongActivityStart, onLongActivityEnd } =
            createImageController();

        const response = await controller.sendMessage('сгенерировать кота', 'chat', [], []);

        expect(transport.generateImage).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'gpt-image',
                model: 'black-forest-labs/flux.2-max',
                prompt: 'сгенерировать кота',
            }),
        );
        expect(events.broadcastReplaceChunk).toHaveBeenCalledWith('image status=starting\n');
        expect(response).toEqual({
            ok: true,
            text: '',
            images: ['data:image/png;base64,abc'],
        });
        expect(onLongActivityStart).toHaveBeenCalledOnce();
        expect(onLongActivityEnd).toHaveBeenCalledOnce();
    });

    it('does not mark failed text responses as successful completions', async () => {
        const { transport } = createTextController();
        transport.send.mockResolvedValueOnce({ ok: false, error: 'upstream failed' });
        const onSuccessfulResponse = vi.fn();

        const failingController = new AIBridgeMessageController({
            getContext: () => null as never,
            transport: transport as never,
            manager: {
                activeProviderId: CUSTOM_TEXT_PROVIDER_ID,
                apiKey: '[secure]',
                model: 'deepseek/deepseek-r1-0528',
                sessionId: 'session-1',
                maxOutputTokens: 4096,
                refreshActiveApiKey: vi.fn().mockResolvedValue(undefined),
                isActive: vi.fn(() => true),
            } as never,
            events: {
                broadcastResponse: vi.fn(),
                broadcastReplaceChunk: vi.fn(),
            } as never,
            providerPolicy: new AIBridgeProviderPolicy(),
            tracer: { error: vi.fn() },
            translate: (_key, fallback) => fallback,
            showToast: vi.fn(),
            onActivity: vi.fn(),
            onLongActivityStart: vi.fn(),
            onLongActivityEnd: vi.fn(),
            onSuccessfulResponse,
        });

        await failingController.sendMessage('ошибка', 'chat', [], []);

        expect(onSuccessfulResponse).not.toHaveBeenCalled();
    });

    it('adds local provider context to failed local text responses', async () => {
        const { controller, transport, manager } = createTextController();
        manager.activeProviderId = 'llamacpp';
        manager.model = 'default';
        transport.send.mockResolvedValueOnce({
            ok: false,
            error: 'API Error 503: Service unavailable',
        });

        const response = await controller.sendMessage('hello', 'chat', [], []);

        expect(response).toEqual({
            ok: false,
            error: 'API Error 503: Service unavailable',
            model: 'llamacpp',
        });
    });

    it('overrides generic failed local response models with the local provider id', async () => {
        const { controller, transport, manager } = createTextController();
        manager.activeProviderId = 'llamacpp';
        manager.model = 'default';
        transport.send.mockResolvedValueOnce({
            ok: false,
            error: 'API Error 503: Service unavailable',
            model: 'default',
        });

        const response = await controller.sendMessage('hello', 'chat', [], []);

        expect(response).toEqual({
            ok: false,
            error: 'API Error 503: Service unavailable',
            model: 'llamacpp',
        });
    });

    it('strips image content from history for local text providers', async () => {
        const { controller, transport, manager } = createTextController();
        manager.activeProviderId = 'llamacpp';
        manager.model = 'default';

        await controller.sendMessage(
            'continue',
            'chat',
            [],
            [
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Generated image' },
                        {
                            type: 'image_url',
                            image_url: { url: 'data:image/png;base64,abc' },
                        },
                    ],
                },
            ],
        );

        expect(transport.send).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'llamacpp',
                attachments: [],
                messages: [
                    {
                        role: 'assistant',
                        content:
                            'Generated image\n[Image omitted: the selected local text model does not support image input.]',
                        thought_signature: undefined,
                    },
                    {
                        role: 'user',
                        content: 'continue',
                        thought_signature: undefined,
                    },
                ],
            }),
        );
    });

    it('rejects image attachments before sending them to local text providers', async () => {
        const { controller, transport, manager } = createTextController();
        manager.activeProviderId = 'llamacpp';
        manager.model = 'default';

        const response = await controller.sendMessage(
            'look',
            'chat',
            [{ name: 'image.png', type: 'image/png', data_base64: 'abc' }],
            [],
        );

        expect(response).toEqual({
            ok: false,
            error: 'The selected local text model does not support image input. Remove the image or use a multimodal model with mmproj.',
            model: 'llamacpp',
        });
        expect(transport.send).not.toHaveBeenCalled();
    });

    it('shows missing provider errors as toast without broadcasting chat text', async () => {
        const { controller, events, manager, showToast } = createTextController();
        manager.activeProviderId = null;

        const response = await controller.sendMessage('hello', 'chat', [], []);

        expect(response).toEqual({ ok: false, error: 'No engine found' });
        expect(showToast).toHaveBeenCalledWith('No engine found', 'error');
        expect(events.broadcastResponse).not.toHaveBeenCalled();
    });

    it('shows missing api key errors as toast without broadcasting chat text', async () => {
        const { controller, events, manager, showToast } = createTextController();
        manager.apiKey = null;
        manager.isActive.mockReturnValue(false);

        const response = await controller.sendMessage('hello', 'chat', [], []);

        expect(response).toEqual({ ok: false, error: 'API key missing' });
        expect(showToast).toHaveBeenCalledWith('API key missing', 'error');
        expect(events.broadcastResponse).not.toHaveBeenCalled();
    });

    it('marks silent image prompt preparation as provider activity', async () => {
        const { controller, transport, onActivity } = createTextController();

        const response = await controller.prepareImagePrompt('rewrite image prompt');

        expect(response).toEqual({ ok: true, text: 'prepared' });
        expect(onActivity).toHaveBeenCalledOnce();
        expect(transport.sendSilent).toHaveBeenCalledOnce();
    });
});
