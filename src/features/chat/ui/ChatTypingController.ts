type ChatTypingLogger = {
    warn: (message: string) => void;
};

export class ChatTypingController {
    private readonly _typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(
        private readonly _tracer: ChatTypingLogger,
        private readonly _translate: (key: string, defaultValue?: string) => string,
    ) {}

    public showTyping(
        container: HTMLElement | null,
        id: string,
        onRemove: (id: string) => void,
    ): void {
        if (container === null) return;

        onRemove(id);

        const typingDiv = document.createElement('div');
        typingDiv.id = id;
        typingDiv.className = 'chat-message assistant typing';
        typingDiv.textContent = this._translate('ui.chat.streaming_text', 'Model is typing...');
        container.appendChild(typingDiv);
        container.scrollTop = container.scrollHeight;

        const timeout = globalThis.setTimeout((): void => {
            this._tracer.warn(`[ChatUI] Typing indicator ${id} timed out and was auto-removed`);
            onRemove(id);
        }, 60000);
        this._typingTimeouts.set(id, timeout);
    }

    public removeTyping(id: string): void {
        this.clearTypingTimeout(id);

        const indicator = document.getElementById(id);
        if (indicator !== null) indicator.remove();
    }

    public handleRetryStatus(payload: { code: string; wait_seconds: number }): string | null {
        if (payload.code !== 'GEMINI_QUOTA_RETRY') {
            return null;
        }

        return this._translate(
            'ui.gemini.status.retry',
            'Rate limited. Retrying in {seconds}s...',
        ).replace('{seconds}', payload.wait_seconds.toString());
    }

    public renderTypingStatus(message: string): void {
        const typing = document.querySelector('.chat-message.assistant.typing');
        if (!(typing instanceof HTMLElement)) {
            return;
        }

        const label = document.createElement('div');
        label.className = 'typing-status';
        label.textContent = message;
        label.style.fontSize = '0.8em';
        label.style.opacity = '0.8';
        label.style.marginTop = '4px';

        typing.querySelector('.typing-status')?.remove();
        typing.appendChild(label);
    }

    public clearAll(): void {
        for (const timeoutId of Array.from(this._typingTimeouts.keys())) {
            this.clearTypingTimeout(timeoutId);
        }
    }

    private clearTypingTimeout(id: string): void {
        const timeout = this._typingTimeouts.get(id);
        if (timeout === undefined) {
            return;
        }

        clearTimeout(timeout);
        this._typingTimeouts.delete(id);
    }
}
