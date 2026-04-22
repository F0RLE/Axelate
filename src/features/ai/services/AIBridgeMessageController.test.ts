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
        generateImage: vi.fn(),
        generateImageBackground: vi.fn(),
    };
    const events = {
        broadcastResponse: vi.fn(),
        broadcastReplaceChunk: vi.fn(),
    };
    const manager = {
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
        onSuccessfulResponse: vi.fn(),
    });

    return { controller, transport, events, manager, context };
}

function createImageController() {
    const transport = {
        send: vi.fn(),
        generateImage: vi
            .fn()
            .mockResolvedValue({ ok: true, images: ['data:image/png;base64,abc'] }),
        generateImageBackground: vi.fn(),
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
        onSuccessfulResponse: vi.fn(),
    });

    return { controller, transport, events, manager, context };
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
        const { controller, transport, events } = createImageController();

        const response = await controller.sendMessage('сгенерировать кота', 'chat', [], []);

        expect(transport.generateImage).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'gpt-image',
                model: 'black-forest-labs/flux.2-max',
                prompt: 'сгенерировать кота',
            }),
        );
        expect(events.broadcastReplaceChunk).toHaveBeenCalledWith('🎨 Generating image...\n');
        expect(response).toEqual({
            ok: true,
            text: '',
            images: ['data:image/png;base64,abc'],
        });
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
            onSuccessfulResponse,
        });

        await failingController.sendMessage('ошибка', 'chat', [], []);

        expect(onSuccessfulResponse).not.toHaveBeenCalled();
    });
});
