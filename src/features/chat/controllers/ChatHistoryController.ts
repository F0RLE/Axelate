import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IChatMessage } from '../types/chatTypes';

type ChatHistoryLogger = Pick<LoggerService, 'info' | 'error'>;

type PendingChatRevealStore = {
    getState: () => { pending_chat_reveal?: boolean };
    updateState: (updates: { pending_chat_reveal: boolean }) => void;
};

type ChatHistoryControllerOptions = {
    aiBridge: AIBridge;
    getHistory: () => IChatMessage[];
    setHistory: (history: IChatMessage[]) => void;
    revealLatestMessage: () => void;
    restoreInputText: (text: string) => void;
    renderHistory: (history: IChatMessage[]) => void;
    showEditError: () => void;
    isDestroyed: () => boolean;
    getPendingChatRevealStore: () => PendingChatRevealStore | null;
    tracer: ChatHistoryLogger;
};

export class ChatHistoryController {
    private static readonly _chatRevealFollowUpDelayMs = 120;

    private _historyLoaded = false;
    private _loadedSessionId: string | null = null;
    private _historyLoadInFlight: Promise<void> | null = null;
    private _revealLatestMessageTimeout: ReturnType<typeof setTimeout> | null = null;
    private _revealLatestMessageFrame: number | null = null;

    constructor(private readonly _options: ChatHistoryControllerOptions) {}

    public destroy(): void {
        this.clearRevealLatestMessageTimeout();
        if (this._revealLatestMessageFrame !== null) {
            globalThis.cancelAnimationFrame(this._revealLatestMessageFrame);
            this._revealLatestMessageFrame = null;
        }
    }

    public async ensureHistoryLoaded(): Promise<void> {
        const sessionId = this._options.aiBridge.getSessionId();
        if (this._historyLoaded && this._loadedSessionId === sessionId) return;
        if (this._historyLoadInFlight !== null) {
            await this._historyLoadInFlight;
            return;
        }

        this._historyLoadInFlight = this.loadHistory();
        try {
            await this._historyLoadInFlight;
        } finally {
            this._historyLoadInFlight = null;
        }
    }

    public async editLastTurn(isSending: boolean, fallbackText: string): Promise<void> {
        if (isSending) return;

        try {
            const removedText = await this._options.aiBridge.rewindLastTurn();
            if (removedText === null) {
                this._options.restoreInputText(fallbackText);
                return;
            }

            this.rewindLocalHistory();
            this._options.renderHistory(this._options.getHistory());
            this._options.restoreInputText(removedText);
        } catch (error: unknown) {
            this._options.tracer.error('[Chat] Failed to rewind last turn:', error);
            this._options.showEditError();
        }
    }

    public async regenerateLastTurn(isSending: boolean): Promise<string | null> {
        if (isSending) return null;

        try {
            const removedText = await this._options.aiBridge.rewindLastTurn();
            if (removedText === null) {
                return null;
            }

            this.rewindLocalHistory();
            this._options.renderHistory(this._options.getHistory());
            return removedText;
        } catch (error: unknown) {
            this._options.tracer.error('[Chat] Failed to regenerate last turn:', error);
            this._options.showEditError();
            return null;
        }
    }

    public canRegenerateLastTurnFromText(): boolean {
        const lastUserMessage = [...this._options.getHistory()]
            .reverse()
            .find((message) => message.role === 'user');
        return typeof lastUserMessage?.content === 'string';
    }

    public rewindLocalHistory(): void {
        const history = [...this._options.getHistory()];

        while (history.length > 0) {
            const lastMessage = history.at(-1);
            if (lastMessage?.role === 'user') {
                break;
            }
            history.pop();
        }

        const lastMessage = history.at(-1);
        if (lastMessage?.role === 'user') {
            history.pop();
        }

        this._options.setHistory(history);
    }

    public async loadHistory(): Promise<void> {
        try {
            const sessionId = this._options.aiBridge.getSessionId();
            const history = await this._options.aiBridge.getHistory();
            this._historyLoaded = true;
            this._loadedSessionId = sessionId;

            const nextHistory = Array.isArray(history)
                ? history
                      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
                      .map((msg) => {
                          const historyMessage: IChatMessage = {
                              role: msg.role as 'user' | 'assistant',
                              content: msg.content,
                          };
                          if (msg.thought_signature !== undefined) {
                              historyMessage.thought_signature = msg.thought_signature;
                          }
                          return historyMessage;
                      })
                : [];

            this._options.setHistory(nextHistory);
            this._options.renderHistory(nextHistory);

            if (nextHistory.length > 0) {
                this._options.tracer.info(
                    `[ChatController] Restoring ${String(nextHistory.length)} messages from persistence`,
                );
            }

            if (this.consumePendingChatReveal()) {
                this.scheduleRevealLatestMessage();
            }
        } catch (error: unknown) {
            this._options.tracer.error(
                '[ChatController] Failed to restore persisted history:',
                error,
            );
        }
    }

    public scheduleRevealLatestMessage(): void {
        this.clearRevealLatestMessageTimeout();
        if (this._revealLatestMessageFrame !== null) {
            globalThis.cancelAnimationFrame(this._revealLatestMessageFrame);
        }
        this._revealLatestMessageFrame = globalThis.requestAnimationFrame(() => {
            this._revealLatestMessageFrame = null;
            if (this._options.isDestroyed()) return;
            this._options.revealLatestMessage();
        });
        this._revealLatestMessageTimeout = globalThis.setTimeout(() => {
            this._revealLatestMessageTimeout = null;
            if (this._options.isDestroyed()) return;
            this._options.revealLatestMessage();
        }, ChatHistoryController._chatRevealFollowUpDelayMs);
    }

    public clearRevealLatestMessageTimeout(): void {
        if (this._revealLatestMessageTimeout !== null) {
            globalThis.clearTimeout(this._revealLatestMessageTimeout);
            this._revealLatestMessageTimeout = null;
        }
    }

    public consumePendingChatReveal(): boolean {
        const uiState = this._options.getPendingChatRevealStore();
        const pendingState = uiState?.getState();
        const shouldReveal = pendingState?.pending_chat_reveal === true;
        if (shouldReveal) {
            uiState?.updateState({ pending_chat_reveal: false });
        }
        return shouldReveal;
    }
}
