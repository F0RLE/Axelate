import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardResizer } from './CardResizer';

function setupDom(cardWidth = 'full') {
    document.body.innerHTML = `
        <div class="resizable-card" data-card-id="alpha" data-card-width="${cardWidth}">
            <button class="card-resize-handle" type="button">Resize</button>
        </div>
    `;
}

describe('CardResizer', () => {
    let onSave: (id: string, width: string) => void;
    let savedCalls: Array<[string, string]>;
    let resizer: CardResizer;

    beforeEach(() => {
        setupDom();
        savedCalls = [];
        onSave = (id: string, width: string) => {
            savedCalls.push([id, width]);
        };
        resizer = new CardResizer(onSave);
    });

    afterEach(() => {
        resizer.destroy();
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('should resize card using the live card-resize-handle selector', () => {
        resizer.init();

        const handle = document.querySelector('.card-resize-handle') as HTMLElement;
        const card = document.querySelector('.resizable-card') as HTMLElement;

        handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 200 }));
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 20 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        expect(card.dataset['cardWidth']).toBe('half');
        expect(savedCalls).toEqual([['alpha', 'half']]);
        expect(document.getElementById('resize-overlay')).toBeNull();
    });

    it('should not duplicate listeners when init is called repeatedly', () => {
        resizer.init();
        resizer.init();

        const handle = document.querySelector('.card-resize-handle') as HTMLElement;

        handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 200 }));
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 20 }));

        expect(savedCalls).toHaveLength(1);
    });

    it('should remove listeners on destroy', () => {
        resizer.init();
        resizer.destroy();

        const handle = document.querySelector('.card-resize-handle') as HTMLElement;
        const card = document.querySelector('.resizable-card') as HTMLElement;

        handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 200 }));
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 20 }));

        expect(card.dataset['cardWidth']).toBe('full');
        expect(savedCalls).toHaveLength(0);
    });

    it('should resize half-width cards back to full', () => {
        setupDom('half');
        resizer.destroy();
        savedCalls = [];
        onSave = (id: string, width: string) => {
            savedCalls.push([id, width]);
        };
        resizer = new CardResizer(onSave);
        resizer.init();

        const handle = document.querySelector('.card-resize-handle') as HTMLElement;
        const card = document.querySelector('.resizable-card') as HTMLElement;

        handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20 }));
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 180 }));

        expect(card.dataset['cardWidth']).toBe('full');
        expect(savedCalls).toEqual([['alpha', 'full']]);
    });
});
