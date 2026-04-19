import { describe, expect, it, vi } from 'vitest';
import { ModalFocusTrapHelper } from './ModalFocusTrapHelper';

describe('ModalFocusTrapHelper', () => {
    it('should keep focus inside modal and close on overlay click', () => {
        const onClose = vi.fn();
        const helper = new ModalFocusTrapHelper(onClose);
        const modal = document.createElement('dialog');
        const first = document.createElement('button');
        const last = document.createElement('button');
        const outside = document.createElement('button');

        first.textContent = 'First';
        last.textContent = 'Last';
        outside.textContent = 'Outside';
        modal.append(first, last);
        document.body.append(modal, outside);

        helper.attach(modal);
        helper.focusFirstElement(modal);
        expect(document.activeElement).toBe(first);

        last.focus();
        helper.handleModalKeydown(
            new KeyboardEvent('keydown', {
                key: 'Tab',
                bubbles: true,
                cancelable: true,
            }),
        );
        expect(document.activeElement).toBe(first);

        outside.focus();
        const focusInEvent = new FocusEvent('focusin', { bubbles: true });
        Object.defineProperty(focusInEvent, 'target', {
            configurable: true,
            value: outside,
        });
        helper.handleFocusIn(focusInEvent);
        expect(document.activeElement).toBe(first);

        helper.attachOverlayOnly(modal);
        modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onClose).toHaveBeenCalledTimes(1);

        helper.detach();
        document.body.innerHTML = '';
    });
});
