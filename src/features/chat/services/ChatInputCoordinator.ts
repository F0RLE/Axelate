type TokenUpdater = (text?: string) => Promise<void>;

export class ChatInputCoordinator {
    constructor(
        private readonly _scheduleAutoResizeInput: () => void,
        private readonly _updateTokenCount: TokenUpdater,
    ) {}

    public getInput(): HTMLTextAreaElement | null {
        return document.getElementById('chat-input') as HTMLTextAreaElement | null;
    }

    public clear(): void {
        const input = this.getInput();
        if (!(input instanceof HTMLTextAreaElement)) {
            return;
        }

        input.value = '';
        this._scheduleAutoResizeInput();
    }

    public appendVoiceText(text: string): void {
        const input = this.getInput();
        if (!(input instanceof HTMLTextAreaElement)) {
            return;
        }

        input.value += (input.value ? ' ' : '') + text;
        this._scheduleAutoResizeInput();
        void this._updateTokenCount(input.value);
    }

    public restore(text: string): void {
        const input = this.getInput();
        if (!(input instanceof HTMLTextAreaElement)) {
            return;
        }

        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        input.setSelectionRange(text.length, text.length);
        this._scheduleAutoResizeInput();
    }
}
