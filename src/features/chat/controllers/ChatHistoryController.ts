import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { ChatContent } from '@/features/ai/types/aiTypes';
import { tracer } from '@/infrastructure/logging/LoggerService';
import { getGlobalWin } from '@/shared/utils/globalAccessor';
import type { IChatMessage } from '../types/chatTypes';

type ChatHistoryControllerOptions = {
    aiBridge: AIBridge;
    getHistory: () => IChatMessage[];
    setHistory: (history: IChatMessage[]) => void;
    appendHistoryMessage: (
        role: 'user' | 'assistant',
        text: string,
        options: Record<string, unknown>,
    ) => void;
    revealLatestMessage: () => void;
    extractRenderableText: (content: ChatContent) => string;
    buildHistoryRenderOptions: (
        content: ChatContent,
    ) => { images?: Array<{ mime: string; data_base64: string }> };
    restoreInputText: (text: string) => void;
    renderHistory: (history: IChatMessage[]) => void;
    showEditError: () => void;
    isDestroyed: () => boolean;
};

export class ChatHistoryController {
    private static readonly _historyRetryDelayMs = 300;
    private static readonly _chatRevealFollowUpDelayMs = 120;

    private _historyLoaded = false;
    private _historyLoadInFlight: Promise<void> | null = null;
    private _historyRetryTimeout: ReturnType<typeof setTimeout> | null = null;
    private _revealLatestMessageTimeout: ReturnType<typeof setTimeout> | null = null;
    private _revealLatestMessageFrame: number | null = null;

    constructor(private readonly _options: ChatHistoryControllerOptions) {}

    public destroy(): void {
        if (this._historyRetryTimeout !== null) {
            globalThis.clearTimeout(this._historyRetryTimeout);
            this._historyRetryTimeout = null;
        }

        this.clearRevealLatestMessageTimeout();
        if (this._revealLatestMessageFrame !== null) {
            globalThis.cancelAnimationFrame(this._revealLatestMessageFrame);
            this._revealLatestMessageFrame = null;
        }
    }

    public async ensureHistoryLoaded(): Promise<void> {
        if (this._historyLoaded) return;
        if (this._historyLoadInFlight !== null) {
            await this._historyLoadInFlight;
            return;
        }

        if (this._options.aiBridge.getSessionId() === 'default') {
            this._historyRetryTimeout ??= globalThis.setTimeout(() => {
                this._historyRetryTimeout = null;
                void this.ensureHistoryLoaded();
            }, ChatHistoryController._historyRetryDelayMs);
            return;
        }

        if (this._historyRetryTimeout !== null) {
            globalThis.clearTimeout(this._historyRetryTimeout);
            this._historyRetryTimeout = null;
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
            const nextText = removedText ?? fallbackText;

            this.rewindLocalHistory();
            this._options.renderHistory(this._options.getHistory());
            this._options.restoreInputText(nextText);
        } catch (error: unknown) {
            tracer.error('[Chat] Failed to rewind last turn:', error);
            this._options.showEditError();
        }
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
            const history = await this._options.aiBridge.getHistory();
            this._historyLoaded = true;
            if (Array.isArray(history) && history.length > 0) {
                tracer.info(
                    `[ChatController] Restoring ${String(history.length)} messages from persistence`,
                );

                const nextHistory = history
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
                    });

                this._options.setHistory(nextHistory);

                nextHistory.forEach((msg) => {
                    this._options.appendHistoryMessage(
                        msg.role,
                        this._options.extractRenderableText(msg.content),
                        {
                            tokens: 0,
                            skipAnimation: true,
                            ...this._options.buildHistoryRenderOptions(msg.content),
                        },
                    );
                });
            }

            if (this.consumePendingChatReveal()) {
                this.scheduleRevealLatestMessage();
            }
        } catch (error: unknown) {
            tracer.error('[ChatController] Failed to restore persisted history:', error);
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
        type PendingUiState = {
            getState: () => { pending_chat_reveal?: boolean };
            updateState: (updates: { pending_chat_reveal: boolean }) => void;
        };
        const win = getGlobalWin() as unknown as Window & {
            uiState?: {
                getState?: PendingUiState['getState'];
                updateState?: PendingUiState['updateState'];
            };
        };

        const uiState = win.uiState as PendingUiState | undefined;
        const pendingState = uiState?.getState();
        const shouldReveal = pendingState?.pending_chat_reveal === true;
        if (shouldReveal) {
            uiState?.updateState({ pending_chat_reveal: false });
        }
        return shouldReveal;
    }
}
