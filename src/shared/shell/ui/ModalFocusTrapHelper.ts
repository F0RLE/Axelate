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
        if (event.key !== 'Tab' || this._modal === null) {
            return;
        }

        const focusable = this.getFocusableElements(this._modal);
        if (focusable.length === 0) {
            event.preventDefault();
            this._modal.focus();
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first === undefined || last === undefined) {
            event.preventDefault();
            this._modal.focus();
            return;
        }

        const active = document.activeElement;
        if (event.shiftKey) {
            if (active === first || active === this._modal) {
                event.preventDefault();
                last.focus();
            }
            return;
        }

        if (active === last) {
            event.preventDefault();
            first.focus();
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

        this.focusFirstElement(this._modal);
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
        const first = this.getFocusableElements(modal)[0];
        if (first !== undefined) {
            first.focus();
            return;
        }

        modal.focus();
    }

    public getFocusableElements(root: HTMLElement): HTMLElement[] {
        return [...root.querySelectorAll<HTMLElement>(ModalFocusTrapHelper.FOCUSABLE_SELECTOR)].filter(
            (element) =>
                !element.hasAttribute('disabled') &&
                element.tabIndex !== -1 &&
                element.closest('.hidden') === null &&
                element.getAttribute('aria-hidden') !== 'true',
        );
    }
}
