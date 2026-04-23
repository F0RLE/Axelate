type ConsoleToastType = 'success' | 'error' | 'warning';

type ConsoleClipboardHelperDeps = {
    translate: (key: string, fallback: string) => string;
    showToast: (message: string, type: ConsoleToastType, duration: number) => void;
    copyText: (text: string) => Promise<void>;
};

export class ConsoleClipboardHelper {
    public constructor(private readonly _deps: ConsoleClipboardHelperDeps) {}

    public async copyLogsText(text: string): Promise<void> {
        if (text.length === 0) {
            this.showToast('ui.debug.logs_empty', 'No logs to copy', 'warning', 1500);
            return;
        }

        try {
            await this._writeTextToClipboard(text);
            this.showToast('ui.debug.logs_copied', 'Logs copied', 'success', 1500);
        } catch {
            this.showToast('ui.debug.logs_copy_failed', 'Failed to copy logs', 'error', 1800);
        }
    }

    public showLogsCleared(): void {
        this.showToast('ui.debug.logs_cleared', 'Logs cleared', 'success', 1500);
    }

    private async _writeTextToClipboard(text: string): Promise<void> {
        await this._deps.copyText(text);
    }

    private showToast(
        key: string,
        fallback: string,
        type: ConsoleToastType,
        duration: number,
    ): void {
        this._deps.showToast(this._deps.translate(key, fallback), type, duration);
    }
}
