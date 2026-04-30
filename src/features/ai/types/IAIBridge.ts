import type {
    IChatMessage,
    IBridgeResponse,
    MessageSource,
    MessageHandler,
    IChunkHandler,
    IImageGenerationPreview,
} from './aiTypes';

export type IAIBridgeSendMessageOptions = {
    originalPrompt?: string;
};

export interface IAIBridge {
    isActive(): boolean;
    getActiveProvider(): { id: string; name: string } | null;
    sendMessage(
        text: string,
        source?: MessageSource,
        attachments?: { name: string; type: string; data_base64: string }[],
        history?: IChatMessage[],
        options?: IAIBridgeSendMessageOptions,
    ): Promise<IBridgeResponse>;
    startProvider(providerId: string): Promise<boolean>;
    stopProvider(): void;
    stopEngineSlot(capability: 'text' | 'image' | 'vision'): Promise<void>;
    clearHistory(): Promise<void>;
    getHistory(): Promise<IChatMessage[]>;
    cancelTextGeneration(): Promise<boolean>;
    cancelImageGeneration(providerId?: string | null): Promise<void>;
    getImageGenerationPreview(): Promise<IImageGenerationPreview | null>;
    rewindLastTurn(): Promise<string | null>;
    getState(): { activeProviderId: string | null; isRunning: boolean };
    onMessage(listenerId: string, handler: MessageHandler): void;
    removeListener(listenerId: string): void;
    onChunk(listenerId: string, handler: IChunkHandler): void;
    removeChunkListener(listenerId: string): void;
    onReplaceChunk(listenerId: string, handler: IChunkHandler): void;
    removeReplaceChunkListener(listenerId: string): void;
    onThought(listenerId: string, handler: IChunkHandler): void;
    removeThoughtListener(listenerId: string): void;
}
