type GlobalTextContextMenuTranslate = (key: string, fallback?: string) => string;

type GlobalTextContextMenuDeps = {
    translate: GlobalTextContextMenuTranslate;
    copyText: (text: string) => Promise<void>;
    readClipboardText: () => Promise<string | null>;
    tracer: {
        warn: (message: string, ...args: unknown[]) => void;
    };
};

type TextContextAction = 'cut' | 'copy' | 'paste' | 'selectAll';

type TextContextItem = {
    action: TextContextAction;
    labelKey: string;
    fallback: string;
    shortcut?: string;
    dividerBefore?: boolean;
};

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const TEXT_CONTEXT_ITEMS: TextContextItem[] = [
    {
        action: 'cut',
        labelKey: 'ui.chat.input_menu.cut',
        fallback: 'Cut',
        shortcut: 'Ctrl+X',
    },
    {
        action: 'copy',
        labelKey: 'ui.chat.input_menu.copy',
        fallback: 'Copy',
        shortcut: 'Ctrl+C',
    },
    {
        action: 'paste',
        labelKey: 'ui.chat.input_menu.paste',
        fallback: 'Paste',
        shortcut: 'Ctrl+V',
    },
    {
        action: 'selectAll',
        labelKey: 'ui.chat.input_menu.select_all',
        fallback: 'Select all',
        shortcut: 'Ctrl+A',
        dividerBefore: true,
    },
];

export class GlobalTextContextMenu {
    private _menu: HTMLDivElement | null = null;
    private _target: EditableTarget | null = null;
    private _clipboardText: string | null = null;
    private _openToken = 0;
    private _abort: AbortController | null = null;

    private readonly _boundContextMenu = (event: MouseEvent) => {
        this._handleContextMenu(event);
    };
    private readonly _boundDocumentPointerDown = (event: PointerEvent) => {
        const target = event.target;
        if (target instanceof Node && this._menu?.contains(target) === true) {
            return;
        }
        this.close();
    };
    private readonly _boundKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            this.close();
        }
    };
    private readonly _boundClose = () => {
        this.close();
    };

    public constructor(private readonly _deps: GlobalTextContextMenuDeps) {}

    public init(): void {
        if (this._abort !== null) return;

        this._abort = new AbortController();
        document.addEventListener('contextmenu', this._boundContextMenu, {
            signal: this._abort.signal,
        });
    }

    public destroy(): void {
        this._abort?.abort();
        this._abort = null;
        this.close();
    }

    public close(): void {
        this._openToken += 1;
        this._menu?.remove();
        this._menu = null;
        this._target = null;
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
        const target = this._resolveEditableTarget(event.target);
        if (target === null) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        target.focus({ preventScroll: true });
        this._open(target, event.clientX, event.clientY);
    }

    private _resolveEditableTarget(target: EventTarget | null): EditableTarget | null {
        if (!(target instanceof Element)) {
            return null;
        }

        const editable = target.closest<HTMLElement>(
            'input, textarea, [contenteditable="true"], [role="textbox"]',
        );
        if (editable === null) {
            return null;
        }

        if (editable instanceof HTMLInputElement) {
            const type = editable.type.toLowerCase();
            if (
                [
                    'button',
                    'checkbox',
                    'color',
                    'file',
                    'hidden',
                    'image',
                    'radio',
                    'range',
                    'reset',
                    'submit',
                ].includes(type)
            ) {
                return null;
            }
            return editable;
        }

        return editable;
    }

    private _open(target: EditableTarget, clientX: number, clientY: number): void {
        this.close();
        const openToken = this._openToken;
        this._target = target;
        void this._openWithClipboardState(target, clientX, clientY, openToken);
    }

    private async _openWithClipboardState(
        target: EditableTarget,
        clientX: number,
        clientY: number,
        openToken: number,
    ): Promise<void> {
        const clipboardText = await this._readClipboardForMenu();
        if (this._openToken !== openToken || this._target !== target) {
            return;
        }

        this._clipboardText = clipboardText;

        const menu = document.createElement('div');
        menu.className = 'chat-input-context-menu';
        menu.setAttribute('role', 'menu');
        menu.tabIndex = -1;

        const state = this._getState(target);
        for (const item of TEXT_CONTEXT_ITEMS) {
            if (item.dividerBefore === true) {
                const divider = document.createElement('div');
                divider.className = 'chat-input-context-menu-divider';
                divider.setAttribute('role', 'separator');
                menu.appendChild(divider);
            }
            menu.appendChild(this._createButton(target, item, state));
        }

        if (this._openToken !== openToken || this._target !== target) {
            return;
        }

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
        try {
            return await this._deps.readClipboardText();
        } catch (error) {
            this._deps.tracer.warn('[GlobalTextContextMenu] Clipboard read failed:', error);
            return null;
        }
    }

    private _createButton(
        target: EditableTarget,
        item: TextContextItem,
        state: { hasSelection: boolean; hasText: boolean; readOnly: boolean },
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
            void this._runAction(target, item.action);
        });

        return button;
    }

    private _getState(target: EditableTarget): {
        hasSelection: boolean;
        hasText: boolean;
        readOnly: boolean;
    } {
        if (this._isTextControl(target)) {
            return {
                hasSelection: target.selectionStart !== target.selectionEnd,
                hasText: target.value.length > 0,
                readOnly: target.readOnly || target.disabled,
            };
        }

        const text = target.textContent;
        return {
            hasSelection: window.getSelection()?.toString() !== '',
            hasText: text.length > 0,
            readOnly: target.getAttribute('contenteditable') !== 'true',
        };
    }

    private _isDisabled(
        action: TextContextAction,
        state: { hasSelection: boolean; hasText: boolean; readOnly: boolean },
    ): boolean {
        if (action === 'cut') {
            return state.readOnly || !state.hasSelection;
        }
        if (action === 'copy') {
            return !state.hasSelection;
        }
        if (action === 'paste') {
            return state.readOnly || this._clipboardText === null || this._clipboardText === '';
        }
        return !state.hasText;
    }

    private async _runAction(target: EditableTarget, action: TextContextAction): Promise<void> {
        try {
            if (action === 'selectAll') {
                this._selectAll(target);
                this.close();
                return;
            }

            if (action === 'copy' || action === 'cut') {
                const selectedText = this._selectedText(target);
                if (selectedText === '') {
                    this.close();
                    return;
                }

                await this._deps.copyText(selectedText);
                if (action === 'cut') {
                    this._replaceSelection(target, '');
                }
                this.close();
                return;
            }

            const text = this._clipboardText;
            if (text !== null && text !== '') {
                this._replaceSelection(target, text);
            }
            this.close();
        } catch (error) {
            this._deps.tracer.warn('[GlobalTextContextMenu] Action failed:', error);
            this.close();
        }
    }

    private _selectedText(target: EditableTarget): string {
        if (this._isTextControl(target)) {
            return target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? 0);
        }

        return window.getSelection()?.toString() ?? '';
    }

    private _replaceSelection(target: EditableTarget, text: string): void {
        target.focus({ preventScroll: true });
        if (this._isTextControl(target)) {
            target.setRangeText(text, target.selectionStart ?? 0, target.selectionEnd ?? 0, 'end');
            this._dispatchInputChange(target);
            return;
        }

        document.execCommand('insertText', false, text);
        this._dispatchInputChange(target);
    }

    private _selectAll(target: EditableTarget): void {
        target.focus({ preventScroll: true });
        if (this._isTextControl(target)) {
            target.select();
            return;
        }

        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    }

    private _dispatchInputChange(target: EditableTarget): void {
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
    }

    private _isTextControl(
        target: EditableTarget,
    ): target is HTMLInputElement | HTMLTextAreaElement {
        return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
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
