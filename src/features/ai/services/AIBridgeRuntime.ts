import type { IChatMessage, IChunkHandler, IImageGenerationPreview } from '../types/aiTypes';
import type { AIBridgeContext } from './AIBridgeContext';
import type { AIBridgeEvents } from './AIBridgeEvents';
import type { AIBridgeProviderPolicy } from './AIBridgeProviderPolicy';
import type { IChatTransport } from './AIChatTransport';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import { resolveCustomProviderBackendId } from '@/shared/utils/customProviderSupport';

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

type ImageGenerationLogProgress = {
    percent: number | null;
    step: number | null;
    total: number | null;
    speed: string | null;
};

const parseImageGenerationLogProgress = (line: string): ImageGenerationLogProgress | null => {
    const stepMatch = line.match(/(\d+)\s*\/\s*(\d+)/u);
    const percentMatch = line.match(/(\d+(?:\.\d+)?)\s*%/u);
    const speedMatch = line.match(/(\d+(?:\.\d+)?)\s*(it\/s|s\/it)/iu);

    let step: number | null = null;
    let total: number | null = null;
    let percent: number | null = null;

    if (stepMatch !== null) {
        const parsedStep = Number.parseInt(stepMatch[1] ?? '', 10);
        const parsedTotal = Number.parseInt(stepMatch[2] ?? '', 10);
        if (Number.isFinite(parsedStep) && Number.isFinite(parsedTotal) && parsedTotal > 0) {
            step = parsedStep;
            total = parsedTotal;
            percent = Math.max(0, Math.min(100, Math.round((parsedStep / parsedTotal) * 100)));
        }
    }

    if (percentMatch !== null) {
        const parsedPercent = Number.parseFloat(percentMatch[1] ?? '');
        if (Number.isFinite(parsedPercent)) {
            percent = Math.max(0, Math.min(100, Math.round(parsedPercent)));
        }
    }

    const speed =
        speedMatch === null ? null : `${speedMatch[1]}${speedMatch[2]?.toLowerCase() ?? 'it/s'}`;

    if (percent === null && step === null && speed === null) {
        return null;
    }

    return { percent, step, total, speed };
};

export const buildImageGenerationProgressChunk = (line: string): string | null => {
    const progress = parseImageGenerationLogProgress(line);
    if (progress === null) {
        return line.toLowerCase().includes('generating image') ? 'image status=running\n' : null;
    }

    const fields = ['image', 'status=running'];
    if (progress.percent !== null) fields.push(`percent=${String(progress.percent)}`);
    if (progress.step !== null) fields.push(`step=${String(progress.step)}`);
    if (progress.total !== null) fields.push(`total=${String(progress.total)}`);
    if (progress.speed !== null) fields.push(`speed=${progress.speed}`);

    return `${fields.join(' ')}\n`;
};

const LOCAL_IMAGE_ENGINE_IDS = new Set(['sdcpp', 'stable-diffusion']);

export const isActiveEngineLog = (activeProviderId: string | null, engineId: string): boolean => {
    if (LOCAL_IMAGE_ENGINE_IDS.has(engineId)) {
        return true;
    }

    if (activeProviderId === null) {
        return false;
    }

    const activeBackendId = resolveCustomProviderBackendId(activeProviderId);
    if (activeBackendId === engineId) {
        return true;
    }

    return LOCAL_IMAGE_ENGINE_IDS.has(activeBackendId) && LOCAL_IMAGE_ENGINE_IDS.has(engineId);
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
            if (!isActiveEngineLog(args.getActiveProviderId(), payload.engine_id)) {
                return;
            }

            const progressChunk = buildImageGenerationProgressChunk(line);
            if (progressChunk !== null) {
                args.events.broadcastReplaceChunk(progressChunk);
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

        if (args.providerPolicy.isCloudProvider(args.providerId)) {
            return;
        }

        const isImageProvider = args.providerPolicy.isImageProvider(args.providerId);
        const isManagedLocalImageEngine = args.providerPolicy.isManagedLocalImageEngine(
            args.providerId,
        );

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

        return await (context.tauriProvider as unknown as TauriProvider).invoke(
            'get_chat_history',
            {
                sessionId,
            },
        );
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
            provider: resolveCustomProviderBackendId(providerId),
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
