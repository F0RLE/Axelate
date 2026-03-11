import type {
    IChatMessage,
    IBridgeResponse,
    MessageSource,
    MessageHandler,
    IChunkHandler,
} from './aiTypes';

export interface IAIBridge {
    isActive(): boolean;
    getActiveProvider(): { id: string; name: string } | null;
    sendMessage(
        text: string,
        source?: MessageSource,
        attachments?: { name: string; type: string; data_base64: string }[],
    ): Promise<IBridgeResponse>;
    startProvider(providerId: string): Promise<boolean>;
    stopProvider(): void;
    clearHistory(): Promise<void>;
    getHistory(): Promise<IChatMessage[]>;
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
