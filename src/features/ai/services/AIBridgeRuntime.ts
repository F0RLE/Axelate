import type { IChatMessage, IChunkHandler, IImageGenerationPreview } from '../types/aiTypes';
import type { AIBridgeContext } from './AIBridgeContext';
import type { AIBridgeEvents } from './AIBridgeEvents';
import type { AIBridgeProviderPolicy } from './AIBridgeProviderPolicy';
import type { IChatTransport } from './AIChatTransport';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';

type AIBridgeRuntimeLogger = Pick<LoggerService, 'info' | 'warn' | 'error' | 'debug'>;

type InitializeStreamingArgs = {
    context: AIBridgeContext;
    transport: IChatTransport;
    events: AIBridgeEvents;
    getActiveProviderId: () => string | null;
    broadcastChunk: IChunkHandler;
    broadcastThought: IChunkHandler;
};

type StopCrossSlotEnginesArgs = {
    context: AIBridgeContext | null;
    providerId: string;
    providerPolicy: AIBridgeProviderPolicy;
};

export class AIBridgeRuntime {
    public constructor(private readonly _tracer: AIBridgeRuntimeLogger) {}

    public async initializeStreaming(args: InitializeStreamingArgs): Promise<(() => void)[]> {
        if (!args.context.tauriProvider.isTauri()) {
            this._tracer.info('[AIBridge] Web mode active (Mocks)');
            return [];
        }

        const unlistenLog = await args.context.tauriProvider.listen<{
            engine_id: string;
            line: string;
        }>('ai:engine:log', (payload) => {
            const line = payload.line;
            if (args.getActiveProviderId() !== payload.engine_id) {
                return;
            }

            const progressMatch = line.match(/(\d+\/\d+)|(\d+\.\d+it\/s)|(\d+%)/g);
            if (progressMatch !== null) {
                args.events.broadcastReplaceChunk(
                    `🎨 Generating image... ${progressMatch.join(' - ')}\n`,
                );
                return;
            }

            if (line.includes('generating image')) {
                args.events.broadcastReplaceChunk('🎨 Generating image...\n');
            }
        });

        const unlistenChunk = args.transport.onStream((payload: string) => {
            args.broadcastChunk(payload);
        });

        const unlistenThought = args.transport.onThought((payload: string) => {
            args.broadcastThought(payload);
        });

        this._tracer.info('[AIBridge] Streaming active (IPC via Transport)');
        return [unlistenLog, unlistenChunk, unlistenThought];
    }

    public async stopCrossSlotEngines(args: StopCrossSlotEnginesArgs): Promise<void> {
        if (args.context?.tauriProvider.isTauri() !== true) {
            return;
        }

        const isImageProvider = args.providerPolicy.isImageProvider(args.providerId);
        const isManagedLocalImageEngine =
            args.providerPolicy.isManagedLocalImageEngine(args.providerId);

        try {
            if (isImageProvider) {
                await args.context.tauriProvider.invoke('stop_engine_slot', {
                    capability: 'text',
                });
                if (!isManagedLocalImageEngine) {
                    await args.context.tauriProvider.invoke('stop_engine_slot', {
                        capability: 'image',
                    });
                }
                return;
            }

            await args.context.tauriProvider.invoke('stop_engine_slot', {
                capability: 'image',
            });
        } catch (error) {
            this._tracer.warn(
                `[AIBridge] Failed to stop cross-slot engine for VRAM savings: ${String(error)}`,
            );
        }
    }

    public stopProviderEngine(context: AIBridgeContext | null): void {
        if (context?.tauriProvider.isTauri() !== true) {
            return;
        }

        void context.tauriProvider.invoke('stop_engine').catch((error) => {
            this._tracer.warn(`[AIBridge] Failed to invoke stop_engine: ${String(error)}`);
        });
    }

    public async getHistory(
        context: AIBridgeContext | null,
        sessionId: string,
    ): Promise<IChatMessage[]> {
        if (context?.tauriProvider.isTauri() !== true) {
            return [];
        }

        return await (context.tauriProvider as unknown as TauriProvider).invoke('get_chat_history', {
            sessionId,
        });
    }

    public async clearHistory(context: AIBridgeContext | null, sessionId: string): Promise<void> {
        if (context?.tauriProvider.isTauri() !== true) {
            return;
        }

        await (context.tauriProvider as unknown as TauriProvider).invoke('clear_chat_history', {
            sessionId,
        });
    }

    public async cancelImageGeneration(
        context: AIBridgeContext | null,
        providerId: string,
    ): Promise<void> {
        if (context?.tauriProvider.isTauri() !== true) {
            return;
        }

        await context.tauriProvider.invoke('cancel_image_generation', {
            provider: providerId,
        });
    }

    public async getImageGenerationPreview(
        context: AIBridgeContext | null,
    ): Promise<IImageGenerationPreview | null> {
        if (context?.tauriProvider.isTauri() !== true) {
            return null;
        }

        return await context.tauriProvider.invoke<IImageGenerationPreview | null>(
            'get_image_generation_preview',
        );
    }

    public async rewindLastTurn(
        context: AIBridgeContext | null,
        sessionId: string,
    ): Promise<string | null> {
        if (context?.tauriProvider.isTauri() !== true) {
            return null;
        }

        return await (context.tauriProvider as unknown as TauriProvider).invoke(
            'rewind_last_turn',
            {
                sessionId,
            },
        );
    }
}
