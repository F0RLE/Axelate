import type { IChunkHandler, MessageHandler, MessageSource } from '../types/aiTypes';

export class AIBridgeEvents {
    private readonly _listeners = new Map<string, MessageHandler[]>();
    private readonly _chunkListeners = new Map<string, IChunkHandler[]>();
    private readonly _replaceChunkListeners = new Map<string, IChunkHandler[]>();
    private readonly _thoughtListeners = new Map<string, IChunkHandler[]>();

    public onMessage(listenerId: string, handler: MessageHandler): void {
        if (!this._listeners.has(listenerId)) {
            this._listeners.set(listenerId, []);
        }
        this._listeners.get(listenerId)?.push(handler);
    }

    public removeListener(listenerId: string): void {
        this._listeners.delete(listenerId);
    }

    public onChunk(listenerId: string, handler: IChunkHandler): void {
        if (!this._chunkListeners.has(listenerId)) {
            this._chunkListeners.set(listenerId, []);
        }
        this._chunkListeners.get(listenerId)?.push(handler);
    }

    public removeChunkListener(listenerId: string): void {
        this._chunkListeners.delete(listenerId);
    }

    public onReplaceChunk(listenerId: string, handler: IChunkHandler): void {
        if (!this._replaceChunkListeners.has(listenerId)) {
            this._replaceChunkListeners.set(listenerId, []);
        }
        this._replaceChunkListeners.get(listenerId)?.push(handler);
    }

    public removeReplaceChunkListener(listenerId: string): void {
        this._replaceChunkListeners.delete(listenerId);
    }

    public onThought(listenerId: string, handler: IChunkHandler): void {
        if (!this._thoughtListeners.has(listenerId)) {
            this._thoughtListeners.set(listenerId, []);
        }
        this._thoughtListeners.get(listenerId)?.push(handler);
    }

    public removeThoughtListener(listenerId: string): void {
        this._thoughtListeners.delete(listenerId);
    }

    public broadcastResponse(response: string, source: MessageSource): void {
        this._listeners.forEach((handlers) => {
            handlers.forEach((handler) => {
                handler(response, source);
            });
        });
    }

    public broadcastChunk(chunk: string): void {
        this._chunkListeners.forEach((handlers) => {
            handlers.forEach((handler) => {
                handler(chunk);
            });
        });
    }

    public broadcastReplaceChunk(chunk: string): void {
        this._replaceChunkListeners.forEach((handlers) => {
            handlers.forEach((handler) => {
                handler(chunk);
            });
        });
    }

    public broadcastThought(chunk: string): void {
        this._thoughtListeners.forEach((handlers) => {
            handlers.forEach((handler) => {
                handler(chunk);
            });
        });
    }

    public clear(): void {
        this._listeners.clear();
        this._chunkListeners.clear();
        this._replaceChunkListeners.clear();
        this._thoughtListeners.clear();
    }

    public get listeners(): ReadonlyMap<string, MessageHandler[]> {
        return this._listeners;
    }

    public get chunkListeners(): ReadonlyMap<string, IChunkHandler[]> {
        return this._chunkListeners;
    }

    public get replaceChunkListeners(): ReadonlyMap<string, IChunkHandler[]> {
        return this._replaceChunkListeners;
    }

    public get thoughtListeners(): ReadonlyMap<string, IChunkHandler[]> {
        return this._thoughtListeners;
    }
}
