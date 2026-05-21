export class ModalFocusTrapHelper {
    public static readonly FOCUSABLE_SELECTOR =
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    private _modal: HTMLDialogElement | null = null;
    private readonly _onOverlayClickClose: () => void;

    public constructor(onOverlayClickClose: () => void) {
        this._onOverlayClickClose = onOverlayClickClose;
    }

    public readonly handleOverlayClick = (event: MouseEvent): void => {
        if (event.target === this._modal) {
            this._onOverlayClickClose();
        }
    };

    public readonly handleModalKeydown = (event: KeyboardEvent): void => {
        if (event.key !== 'Tab') {
            return;
        }

        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    };

    public readonly handleFocusIn = (event: FocusEvent): void => {
        if (this._modal === null) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Node) || this._modal.contains(target)) {
            return;
        }

        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    };

    public attach(modal: HTMLDialogElement): void {
        this.detach();
        this._modal = modal;
        modal.addEventListener('click', this.handleOverlayClick);
        modal.addEventListener('keydown', this.handleModalKeydown);
        document.addEventListener('focusin', this.handleFocusIn);
    }

    public attachOverlayOnly(modal: HTMLDialogElement): void {
        this.detach();
        this._modal = modal;
        modal.addEventListener('click', this.handleOverlayClick);
    }

    public detach(): void {
        if (this._modal !== null) {
            this._modal.removeEventListener('click', this.handleOverlayClick);
            this._modal.removeEventListener('keydown', this.handleModalKeydown);
            this._modal = null;
        }

        document.removeEventListener('focusin', this.handleFocusIn);
    }

    public focusFirstElement(modal: HTMLDialogElement): void {
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }

        modal.blur();
    }

    public getFocusableElements(root: HTMLElement): HTMLElement[] {
        return [
            ...root.querySelectorAll<HTMLElement>(ModalFocusTrapHelper.FOCUSABLE_SELECTOR),
        ].filter(
            (element) =>
                !element.hasAttribute('disabled') &&
                element.tabIndex !== -1 &&
                element.closest('.hidden') === null &&
                element.closest('[hidden]') === null &&
                element.closest('[inert]') === null &&
                element.getAttribute('aria-hidden') !== 'true',
        );
    }
}
