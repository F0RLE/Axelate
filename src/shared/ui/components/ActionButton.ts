import { BaseComponent } from '../BaseComponent';

/**
 * @class ActionButton
 * @description A wrapper for button elements that handles loading states and click events.
 */
export class ActionButton extends BaseComponent {
    private _isLoading = false;

    constructor(
        private readonly _id: string,
        private readonly _onClick: (e: MouseEvent) => void | Promise<void>,
    ) {
        super();
    }

    /**
     * Finds the button in the DOM and attaches the click handler.
     */
    protected onInit(): void {
        const btn = this.getElement<HTMLButtonElement>(this._id);
        if (btn) {
            btn.addEventListener('click', async (e) => {
                if (this._isLoading) return;
                
                try {
                    const result = this._onClick(e);
                    if (result instanceof Promise) {
                        this.setLoading(true);
                        await result;
                    }
                } finally {
                    this.setLoading(false);
                }
            }, { signal: this._abortController!.signal });
        }
    }

    /**
     * Cleanup is handled by BaseComponent's AbortController.
     */
    protected onDestroy(): void {
        // No additional cleanup needed
    }

    /**
     * Manually toggle loading state.
     */
    public setLoading(loading: boolean): void {
        this._isLoading = loading;
        const btn = this.getElement<HTMLButtonElement>(this._id);
        if (btn) {
            btn.classList.toggle('loading', loading);
            btn.disabled = loading;
        }
    }

    /**
     * Set button text.
     */
    public setText(text: string): void {
        const btn = this.getElement<HTMLButtonElement>(this._id);
        if (btn) btn.textContent = text;
    }
}
