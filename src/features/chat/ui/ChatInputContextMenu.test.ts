import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatInputContextMenu } from './ChatInputContextMenu';

const translate = (key: string, fallback?: string) => `t:${key}:${fallback ?? ''}`;

function setupMenu(options?: { canPaste?: boolean; clipboardText?: string | null }) {
    document.body.innerHTML = `
        <div class="chat-input-bar">
            <div class="chat-input-field">
                <textarea id="chat-input">hello world</textarea>
                <div id="chat-input-placeholder">Ask something</div>
            </div>
        </div>
    `;
    const input = document.getElementById('chat-input') as HTMLTextAreaElement;
    const field = document.querySelector('.chat-input-field') as HTMLElement;
    const placeholder = document.getElementById('chat-input-placeholder') as HTMLElement;
    const copyText = vi.fn().mockResolvedValue(undefined);
    const readClipboardText = vi.fn().mockResolvedValue(options?.clipboardText ?? ' pasted');
    const warn = vi.fn();
    const menu = new ChatInputContextMenu({
        translate,
        copyText,
        readClipboardText,
        canPaste: () => options?.canPaste ?? false,
        tracer: { warn },
    });
    menu.bind(input);
    return { input, field, placeholder, menu, copyText, readClipboardText, warn };
}

function openMenu(target: HTMLElement): MouseEvent {
    const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 24,
        clientY: 32,
    });
    target.dispatchEvent(event);
    return event;
}

async function openMenuAndFlush(target: HTMLElement): Promise<MouseEvent> {
    const event = openMenu(target);
    await Promise.resolve();
    return event;
}

function getButton(action: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(
        `.chat-input-context-menu-item[data-action="${action}"]`,
    );
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Context menu action not found: ${action}`);
    }
    return button;
}

describe('ChatInputContextMenu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: vi.fn().mockResolvedValue(' pasted'),
            },
        });
    });

    it('opens a custom menu and prevents the browser context menu', async () => {
        const { input, placeholder } = setupMenu();
        input.setSelectionRange(0, 5);

        const event = await openMenuAndFlush(placeholder);

        expect(event.defaultPrevented).toBe(true);
        expect(document.querySelector('.chat-input-context-menu')).toBeInstanceOf(HTMLElement);
        expect(getButton('copy').disabled).toBe(false);
        expect(document.querySelector('[data-action="paste"]')).toBeNull();
    });

    it('opens from the whole input bar in expanded chat state', async () => {
        const { field } = setupMenu();
        const bar = document.querySelector('.chat-input-bar') as HTMLElement;
        field.remove();

        const event = await openMenuAndFlush(bar);

        expect(event.defaultPrevented).toBe(true);
        expect(document.querySelector('.chat-input-context-menu')).toBeInstanceOf(HTMLElement);
    });

    it('pastes through the injected clipboard reader when available', async () => {
        const { input, readClipboardText } = setupMenu({ canPaste: true, clipboardText: ' Tauri' });
        input.setSelectionRange(5, 5);
        await openMenuAndFlush(input);

        getButton('paste').click();
        await Promise.resolve();

        expect(readClipboardText).toHaveBeenCalledTimes(1);
        expect(input.value).toBe('hello Tauri world');
    });

    it('disables paste when the Tauri clipboard is empty', async () => {
        const { input } = setupMenu({ canPaste: true, clipboardText: '' });

        await openMenuAndFlush(input);

        expect(getButton('paste').disabled).toBe(true);
    });

    it('copies and cuts selected text', async () => {
        const { input, copyText } = setupMenu();
        input.setSelectionRange(0, 5);
        await openMenuAndFlush(input);

        getButton('copy').click();
        await Promise.resolve();

        expect(copyText).toHaveBeenCalledWith('hello');

        input.setSelectionRange(6, 11);
        await openMenuAndFlush(input);
        getButton('cut').click();
        await Promise.resolve();

        expect(copyText).toHaveBeenLastCalledWith('world');
        expect(input.value).toBe('hello ');
    });

    it('selects all text and closes on Escape', async () => {
        const { input } = setupMenu();
        await openMenuAndFlush(input);

        getButton('selectAll').click();

        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe(input.value.length);
        expect(document.querySelector('.chat-input-context-menu')).toBeNull();

        await openMenuAndFlush(input);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(document.querySelector('.chat-input-context-menu')).toBeNull();
    });
});
