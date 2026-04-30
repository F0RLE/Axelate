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
    private _bindToken: { cancelled: boolean } | null = null;

    public constructor(private readonly _deps: ChatUiRetryStatusListenerDeps) {}

    public async bind(): Promise<void> {
        if (!this._deps.isTauriRuntime() || this._unlisten !== null) {
            return;
        }

        const bindToken = { cancelled: false };
        this._bindToken = bindToken;
        const unlisten = await listen<RetryStatusPayload>('ai:status:retry', (event) => {
            this._deps.onRetryStatus(event.payload);
        });
        if (bindToken.cancelled) {
            unlisten();
            return;
        }

        this._unlisten = unlisten;
    }

    public destroy(): void {
        if (this._bindToken !== null) {
            this._bindToken.cancelled = true;
            this._bindToken = null;
        }
        this._unlisten?.();
        this._unlisten = null;
    }
}
