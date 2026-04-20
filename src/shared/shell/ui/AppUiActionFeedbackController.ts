import type { AppUiChrome } from './AppUiChrome';

type ActionFeedbackType = 'success' | 'error' | 'warning' | 'info';

export class AppUiActionFeedbackController {
    private _hideTimer: ReturnType<typeof setTimeout> | null = null;

    public constructor(private readonly _chrome: AppUiChrome) {}

    public show(type: ActionFeedbackType = 'success'): void {
        const feedback = this._chrome.ensureActionFeedback();
        const iconByType: Record<ActionFeedbackType, string> = {
            success: '✓',
            error: '✕',
            warning: '!',
            info: 'i',
        };

        this.clear();
        feedback.className = `action-feedback ${type}`;
        const iconElement = feedback.querySelector('.action-feedback-icon');
        if (iconElement !== null) {
            iconElement.textContent = iconByType[type];
        }
        feedback.classList.add('show');

        const target = feedback;
        this._hideTimer = globalThis.setTimeout(() => {
            this._hideTimer = null;
            target.classList.remove('show');
        }, 600);
    }

    public clear(): void {
        if (this._hideTimer !== null) {
            globalThis.clearTimeout(this._hideTimer);
            this._hideTimer = null;
        }

        const feedback = document.getElementById('action-feedback');
        if (feedback instanceof HTMLElement) {
            feedback.classList.remove('show');
        }
    }
}
