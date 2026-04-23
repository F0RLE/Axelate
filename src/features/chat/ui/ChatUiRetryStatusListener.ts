import { listen } from '@tauri-apps/api/event';

type RetryStatusPayload = {
    code: string;
    wait_seconds: number;
};

type ChatUiRetryStatusListenerDeps = {
    isTauriRuntime: () => boolean;
    onRetryStatus: (payload: RetryStatusPayload) => void;
};

export class ChatUiRetryStatusListener {
    private _unlisten: (() => void) | null = null;

    public constructor(private readonly _deps: ChatUiRetryStatusListenerDeps) {}

    public async bind(): Promise<void> {
        if (!this._deps.isTauriRuntime() || this._unlisten !== null) {
            return;
        }

        this._unlisten = await listen<RetryStatusPayload>('ai:status:retry', (event) => {
            this._deps.onRetryStatus(event.payload);
        });
    }

    public destroy(): void {
        this._unlisten?.();
        this._unlisten = null;
    }
}
