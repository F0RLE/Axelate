type ChatTranslate = (
    key: string,
    defaultValue?: string,
    params?: Record<string, unknown>,
) => string;

export class ChatTokenCountPresenter {
    public constructor(private readonly _translate: ChatTranslate) {}

    public update(element: HTMLElement | null, count: number): void {
        if (element === null) {
            return;
        }

        if (count > 0) {
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

            return;
        }

        element.classList.remove('visible');
        element.style.display = 'none';
    }
}
