type ChatTranslate = (
    key: string,
    defaultValue?: string,
    params?: Record<string, unknown>,
) => string;

export class ChatTokenCountPresenter {
    public constructor(private readonly _translate: ChatTranslate) {}

    public update(
        element: HTMLElement | null,
        count: number,
        contextButton: HTMLElement | null = null,
        maxTokens?: number,
        forceVisible = false,
    ): void {
        if (count > 0) {
            this._showTextCounter(element, count);
            this._updateContextButton(contextButton, count, maxTokens, forceVisible);

            return;
        }

        this._hideTextCounter(element);
        this._updateContextButton(contextButton, 0, maxTokens, forceVisible);
    }

    private _showTextCounter(element: HTMLElement | null, count: number): void {
        if (element === null) {
            return;
        }

        element.textContent = `${String(count)} ${this._translate('ui.launcher.web.tokens', 'tokens')}`;
        element.classList.add('visible');
        element.style.display = '';

        if (count > 20000) {
            element.style.color = 'var(--danger)';
        } else if (count > 10000) {
            element.style.color = 'var(--warning)';
        } else {
            element.style.color = '';
        }
    }

    private _hideTextCounter(element: HTMLElement | null): void {
        if (element === null) {
            return;
        }

        element.classList.remove('visible');
        element.style.display = 'none';
    }

    private _updateContextButton(
        button: HTMLElement | null,
        count: number,
        maxTokens?: number,
        forceVisible = false,
    ): void {
        if (button === null) {
            return;
        }

        const hasLimit =
            typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0;
        const ratio = hasLimit ? Math.min(1, Math.max(0, count / maxTokens)) : 0;
        const percent = Math.round(ratio * 100);
        const tokenLabel = this._translate('ui.launcher.web.tokens', 'tokens');
        const contextLabel = this._translate('ui.chat.context_usage', 'Context');
        const usedLabel = this._translate('ui.chat.context_used', 'used');
        const remainingLabel = this._translate('ui.chat.context_remaining', 'remaining');
        const unavailable = this._translate('ui.chat.context_unknown', 'unknown');
        const remainingPercent = hasLimit ? Math.max(0, 100 - percent) : 0;
        const maxLabel = hasLimit ? String(maxTokens) : unavailable;

        button.style.setProperty('--chat-context-fill', `${String(percent)}%`);
        button.classList.toggle('visible', forceVisible || count > 0);
        button.classList.toggle('warning', ratio >= 0.75 && ratio < 0.9);
        button.classList.toggle('danger', ratio >= 0.9);
        button.dataset['tooltip'] = hasLimit
            ? `${contextLabel}\n${String(percent)}% ${usedLabel}\n${String(remainingPercent)}% ${remainingLabel}\n${String(count)} / ${maxLabel} ${tokenLabel}`
            : `${contextLabel}: ${String(count)} / ${maxLabel}`;
        button.title = button.dataset['tooltip'];
        button.setAttribute('aria-label', button.dataset['tooltip']);
    }
}
