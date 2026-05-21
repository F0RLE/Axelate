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

    it('should prefer content controls over close buttons for initial modal focus', () => {
        const helper = new ModalFocusTrapHelper(vi.fn());
        const modal = document.createElement('dialog');
        const closeButton = document.createElement('button');
        const actionButton = document.createElement('button');

        closeButton.className = 'app-close-btn';
        closeButton.textContent = 'Close';
        actionButton.textContent = 'Select';
        modal.append(closeButton, actionButton);
        document.body.append(modal);

        helper.focusFirstElement(modal);

        expect(document.activeElement).toBe(actionButton);

        helper.detach();
        document.body.innerHTML = '';
    });

    it('should skip hidden and inert controls in tab order', () => {
        const helper = new ModalFocusTrapHelper(vi.fn());
        const modal = document.createElement('dialog');
        const hiddenWrapper = document.createElement('div');
        const hiddenButton = document.createElement('button');
        const inertWrapper = document.createElement('div');
        const inertButton = document.createElement('button');
        const visibleButton = document.createElement('button');

        hiddenWrapper.hidden = true;
        hiddenWrapper.append(hiddenButton);
        inertWrapper.setAttribute('inert', '');
        inertWrapper.append(inertButton);
        modal.append(hiddenWrapper, inertWrapper, visibleButton);
        document.body.append(modal);

        expect(helper.getFocusableElements(modal)).toEqual([visibleButton]);

        helper.detach();
        document.body.innerHTML = '';
    });
});
