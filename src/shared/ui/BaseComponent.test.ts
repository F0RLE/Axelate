import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseComponent } from './BaseComponent';

class TestComponent extends BaseComponent {
    public readonly initHook = vi.fn();
    public readonly destroyHook = vi.fn();

    protected onInit(): void {
        this.initHook();
    }

    protected onDestroy(): void {
        this.destroyHook();
    }

    public lookup<T extends HTMLElement>(id: string): T | null {
        return this.getElement<T>(id);
    }

    public visible(id: string): boolean {
        return this.isVisible(id);
    }
}

class FailingComponent extends BaseComponent {
    public readonly initHook = vi.fn();
    public readonly destroyHook = vi.fn();

    protected onInit(): void {
        this.initHook();
        throw new Error('init failed');
    }

    protected onDestroy(): void {
        this.destroyHook();
    }
}

describe('BaseComponent', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('initializes only once and caches element lookups', async () => {
        document.body.innerHTML = `<div id="alpha"></div>`;
        const component = new TestComponent();

        await component.init();
        await component.init();

        expect(component.initHook).toHaveBeenCalledTimes(1);
        expect(component.lookup('alpha')).toBe(document.getElementById('alpha'));
        document.getElementById('alpha')?.remove();
        expect(component.lookup('alpha')).not.toBeNull();
    });

    it('destroys once, aborts listeners and clears cache', async () => {
        document.body.innerHTML = `<div id="beta"></div>`;
        const component = new TestComponent();

        await component.init();
        component.lookup('beta');
        component.destroy();
        component.destroy();
        document.getElementById('beta')?.remove();

        expect(component.destroyHook).toHaveBeenCalledTimes(1);
        expect(component.lookup('beta')).toBeNull();
    });

    it('checks element visibility based on offsetParent', async () => {
        const element = document.createElement('div');
        element.id = 'visible-node';
        Object.defineProperty(element, 'offsetParent', {
            configurable: true,
            get: () => document.body,
        });
        document.body.appendChild(element);

        const component = new TestComponent();
        await component.init();

        expect(component.visible('visible-node')).toBe(true);
        expect(component.visible('missing-node')).toBe(false);
    });

    it('resets init state after failed initialization so retry can work', async () => {
        const component = new FailingComponent();

        await component.init();
        await component.init();

        expect(component.initHook).toHaveBeenCalledTimes(2);
        component.destroy();
        expect(component.destroyHook).not.toHaveBeenCalled();
    });
});
