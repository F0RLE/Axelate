import type { IChatMessage } from '../types/chatTypes';

export class ChatControllerState {
    private _history: IChatMessage[] = [];
    private _currentGreetingIndex = 1;
    private _isSending = false;
    private _eventsBound = false;
    private _isInitialized = false;
    private _isDestroyed = false;

    public get history(): IChatMessage[] {
        return this._history;
    }

    public set history(history: IChatMessage[]) {
        this._history = history;
    }

    public clearHistory(): void {
        this._history = [];
    }

    public pushHistoryMessage(message: IChatMessage): void {
        this._history.push(message);
    }

    public get currentGreetingIndex(): number {
        return this._currentGreetingIndex;
    }

    public set currentGreetingIndex(index: number) {
        this._currentGreetingIndex = index;
    }

    public get isSending(): boolean {
        return this._isSending;
    }

    public set isSending(value: boolean) {
        this._isSending = value;
    }

    public get eventsBound(): boolean {
        return this._eventsBound;
    }

    public set eventsBound(value: boolean) {
        this._eventsBound = value;
    }

    public get isInitialized(): boolean {
        return this._isInitialized;
    }

    public set isInitialized(value: boolean) {
        this._isInitialized = value;
    }

    public get isDestroyed(): boolean {
        return this._isDestroyed;
    }

    public set isDestroyed(value: boolean) {
        this._isDestroyed = value;
    }
}
