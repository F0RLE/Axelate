import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalTextContextMenu } from './GlobalTextContextMenu';

function createMenu(options?: { clipboardText?: string | null }) {
    const copyText = vi.fn().mockResolvedValue(undefined);
    const readClipboardText = vi.fn().mockResolvedValue(options?.clipboardText ?? ' pasted');
    const warn = vi.fn();
    const menu = new GlobalTextContextMenu({
        translate: (_key, fallback) => fallback ?? _key,
        copyText,
        readClipboardText,
        tracer: { warn },
    });

    menu.init();
    return { menu, copyText, readClipboardText, warn };
}

function openContextMenu(target: HTMLElement): void {
    target.dispatchEvent(
        new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 20,
            clientY: 30,
        }),
    );
}

function getButton(action: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
}

describe('GlobalTextContextMenu', () => {
    let activeMenu: GlobalTextContextMenu | null = null;

    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        activeMenu?.destroy();
        activeMenu = null;
    });

    it('replaces the browser menu for normal inputs', async () => {
        const input = document.createElement('input');
        input.value = 'hello';
        input.setSelectionRange(0, 5);
        document.body.appendChild(input);

        activeMenu = createMenu().menu;
        openContextMenu(input);
        await vi.waitFor(() => {
            expect(document.querySelector('.chat-input-context-menu')).not.toBeNull();
        });

        expect(getButton('copy').disabled).toBe(false);
        expect(getButton('paste').disabled).toBe(false);
    });

    it('copies, cuts, pastes, and selects text controls', async () => {
        const input = document.createElement('input');
        input.value = 'hello world';
        input.setSelectionRange(0, 5);
        document.body.appendChild(input);
        const created = createMenu({ clipboardText: 'Axelate' });
        activeMenu = created.menu;
        const { copyText } = created;

        openContextMenu(input);
        await vi.waitFor(() => expect(getButton('copy')).not.toBeNull());
        getButton('copy').click();
        await vi.waitFor(() => expect(copyText).toHaveBeenCalledWith('hello'));

        input.setSelectionRange(6, 11);
        openContextMenu(input);
        await vi.waitFor(() => expect(getButton('cut')).not.toBeNull());
        getButton('cut').click();
        await vi.waitFor(() => expect(input.value).toBe('hello '));

        openContextMenu(input);
        await vi.waitFor(() => expect(getButton('paste')).not.toBeNull());
        getButton('paste').click();
        await vi.waitFor(() => expect(input.value).toBe('hello Axelate'));

        openContextMenu(input);
        await vi.waitFor(() => expect(getButton('selectAll')).not.toBeNull());
        getButton('selectAll').click();
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe(input.value.length);
    });

    it('does not open on non-editable launcher chrome', async () => {
        const button = document.createElement('button');
        button.textContent = 'Home';
        document.body.appendChild(button);
        activeMenu = createMenu().menu;

        openContextMenu(button);
        await Promise.resolve();

        expect(document.querySelector('.chat-input-context-menu')).toBeNull();
    });
});
