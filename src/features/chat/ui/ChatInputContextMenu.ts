type ChatInputContextMenuTranslate = (key: string, fallback?: string) => string;

type ChatInputContextMenuDeps = {
    translate: ChatInputContextMenuTranslate;
    copyText: (text: string) => Promise<void>;
    readClipboardText: () => Promise<string | null>;
    canPaste: () => boolean;
    tracer: {
        warn: (message: string, ...args: unknown[]) => void;
    };
};

type ChatInputContextMenuAction = 'cut' | 'copy' | 'paste' | 'selectAll';

type ChatInputContextMenuItem = {
    action: ChatInputContextMenuAction;
    labelKey: string;
    fallback: string;
    shortcut?: string;
    dividerBefore?: boolean;
};

const CHAT_INPUT_CONTEXT_MENU_ITEMS: ChatInputContextMenuItem[] = [
    {
        action: 'cut',
        labelKey: 'ui.chat.input_menu.cut',
        fallback: 'Вырезать',
        shortcut: 'Ctrl+X',
    },
    {
        action: 'copy',
        labelKey: 'ui.chat.input_menu.copy',
        fallback: 'Копировать',
        shortcut: 'Ctrl+C',
    },
    {
        action: 'paste',
        labelKey: 'ui.chat.input_menu.paste',
        fallback: 'Вставить',
        shortcut: 'Ctrl+V',
    },
    {
        action: 'selectAll',
        labelKey: 'ui.chat.input_menu.select_all',
        fallback: 'Выбрать все',
        shortcut: 'Ctrl+A',
        dividerBefore: true,
    },
];

export class ChatInputContextMenu {
    private _menu: HTMLDivElement | null = null;
    private _input: HTMLTextAreaElement | null = null;
    private _target: HTMLElement | null = null;
    private _clipboardText: string | null = null;
    private _boundContextMenu: (event: MouseEvent) => void;
    private _boundDocumentPointerDown: (event: PointerEvent) => void;
    private _boundKeyDown: (event: KeyboardEvent) => void;
    private _boundClose: () => void;

    public constructor(private readonly _deps: ChatInputContextMenuDeps) {
        this._boundContextMenu = (event) => {
            this._handleContextMenu(event);
        };
        this._boundDocumentPointerDown = (event) => {
            const target = event.target;
            if (target instanceof Node && this._menu?.contains(target) === true) {
                return;
            }
            this.close();
        };
        this._boundKeyDown = (event) => {
            if (event.key === 'Escape') {
                this.close();
            }
        };
        this._boundClose = () => {
            this.close();
        };
    }

    public bind(input: HTMLTextAreaElement | null): void {
        if (this._input === input) {
            return;
        }

        this.destroy();
        this._input = input;
        this._target = this._resolveContextTarget(input);
        this._target?.addEventListener('contextmenu', this._boundContextMenu);
    }

    public destroy(): void {
        this._target?.removeEventListener('contextmenu', this._boundContextMenu);
        this._target = null;
        this._input = null;
        this.close();
    }

    public close(): void {
        this._menu?.remove();
        this._menu = null;
        this._clipboardText = null;
        document.removeEventListener('pointerdown', this._boundDocumentPointerDown, {
            capture: true,
        });
        document.removeEventListener('keydown', this._boundKeyDown, { capture: true });
        window.removeEventListener('blur', this._boundClose);
        window.removeEventListener('resize', this._boundClose);
        document.removeEventListener('scroll', this._boundClose, { capture: true });
    }

    private _handleContextMenu(event: MouseEvent): void {
        const input = this._input;
        if (input === null || input.disabled || input.readOnly) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        input.focus();
        this._open(input, event.clientX, event.clientY);
    }

    private _resolveContextTarget(input: HTMLTextAreaElement | null): HTMLElement | null {
        if (input === null) {
            return null;
        }

        return (
            input.closest<HTMLElement>('.chat-input-bar') ??
            input.closest<HTMLElement>('.chat-input-field') ??
            input
        );
    }

    private _open(input: HTMLTextAreaElement, clientX: number, clientY: number): void {
        this.close();
        void this._openWithClipboardState(input, clientX, clientY);
    }

    private async _openWithClipboardState(
        input: HTMLTextAreaElement,
        clientX: number,
        clientY: number,
    ): Promise<void> {
        this._clipboardText = await this._readClipboardForMenu();

        const menu = document.createElement('div');
        menu.className = 'chat-input-context-menu';
        menu.setAttribute('role', 'menu');
        menu.tabIndex = -1;

        const state = this._getState(input);
        this._getVisibleItems().forEach((item) => {
            if (item.dividerBefore === true) {
                const divider = document.createElement('div');
                divider.className = 'chat-input-context-menu-divider';
                divider.setAttribute('role', 'separator');
                menu.appendChild(divider);
            }

            menu.appendChild(this._createButton(input, item, state));
        });

        document.body.appendChild(menu);
        this._menu = menu;
        this._positionMenu(menu, clientX, clientY);
        menu.focus({ preventScroll: true });

        document.addEventListener('pointerdown', this._boundDocumentPointerDown, {
            capture: true,
        });
        document.addEventListener('keydown', this._boundKeyDown, { capture: true });
        window.addEventListener('blur', this._boundClose);
        window.addEventListener('resize', this._boundClose);
        document.addEventListener('scroll', this._boundClose, { capture: true });
    }

    private async _readClipboardForMenu(): Promise<string | null> {
        if (!this._deps.canPaste()) {
            return null;
        }

        try {
            return await this._deps.readClipboardText();
        } catch (error) {
            this._deps.tracer.warn('[ChatInputContextMenu] Clipboard read failed:', error);
            return null;
        }
    }

    private _createButton(
        input: HTMLTextAreaElement,
        item: ChatInputContextMenuItem,
        state: { hasSelection: boolean; hasText: boolean },
    ): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chat-input-context-menu-item';
        button.dataset['action'] = item.action;
        button.setAttribute('role', 'menuitem');
        button.disabled = this._isDisabled(item.action, state);

        const label = document.createElement('span');
        label.className = 'chat-input-context-menu-label';
        label.textContent = this._deps.translate(item.labelKey, item.fallback);
        button.appendChild(label);

        if (item.shortcut !== undefined) {
            const shortcut = document.createElement('span');
            shortcut.className = 'chat-input-context-menu-shortcut';
            shortcut.textContent = item.shortcut;
            button.appendChild(shortcut);
        }

        button.addEventListener('click', () => {
            void this._runAction(input, item.action);
        });

        return button;
    }

    private _getState(input: HTMLTextAreaElement): {
        hasSelection: boolean;
        hasText: boolean;
    } {
        return {
            hasSelection: input.selectionStart !== input.selectionEnd,
            hasText: input.value.length > 0,
        };
    }

    private _isDisabled(
        action: ChatInputContextMenuAction,
        state: { hasSelection: boolean; hasText: boolean },
    ): boolean {
        if (action === 'cut' || action === 'copy') {
            return !state.hasSelection;
        }
        if (action === 'selectAll') {
            return !state.hasText;
        }
        return this._clipboardText === null || this._clipboardText === '';
    }

    private async _runAction(
        input: HTMLTextAreaElement,
        action: ChatInputContextMenuAction,
    ): Promise<void> {
        try {
            if (action === 'selectAll') {
                input.focus();
                input.select();
                this.close();
                return;
            }

            if (action === 'copy' || action === 'cut') {
                const selectedText = input.value.slice(input.selectionStart, input.selectionEnd);
                if (selectedText === '') {
                    this.close();
                    return;
                }

                await this._deps.copyText(selectedText);
                if (action === 'cut') {
                    input.setRangeText('', input.selectionStart, input.selectionEnd, 'start');
                    this._dispatchInputChange(input);
                }
                this.close();
                return;
            }

            const text = this._clipboardText;
            if (text !== null && text !== '') {
                input.focus();
                input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
                this._dispatchInputChange(input);
            }
            this.close();
        } catch (error) {
            this._deps.tracer.warn('[ChatInputContextMenu] Action failed:', error);
            this.close();
        }
    }

    private _getVisibleItems(): ChatInputContextMenuItem[] {
        if (this._deps.canPaste()) {
            return CHAT_INPUT_CONTEXT_MENU_ITEMS;
        }

        return CHAT_INPUT_CONTEXT_MENU_ITEMS.filter((item) => item.action !== 'paste');
    }

    private _dispatchInputChange(input: HTMLTextAreaElement): void {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    private _positionMenu(menu: HTMLElement, clientX: number, clientY: number): void {
        const viewportPadding = 8;
        const rect = menu.getBoundingClientRect();
        const left = Math.min(
            Math.max(clientX, viewportPadding),
            window.innerWidth - rect.width - viewportPadding,
        );
        const top = Math.min(
            Math.max(clientY, viewportPadding),
            window.innerHeight - rect.height - viewportPadding,
        );

        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
    }
}
