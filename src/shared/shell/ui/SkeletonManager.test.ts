import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkeletonManager } from './SkeletonManager';

describe('SkeletonManager', () => {
    let manager: SkeletonManager;

    beforeEach(() => {
        manager = new SkeletonManager();
        document.body.innerHTML = `
            <div id="mods">
                <div id="mods-skeleton-1" style="display:none"></div>
                <div id="mods-skeleton-2" style="display:none"></div>
                <div id="mods-skeleton-3" style="display:none"></div>
            </div>
        `;
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('shows and hides skeleton elements directly', () => {
        manager.show('mods', 2);

        expect((document.getElementById('mods-skeleton-1') as HTMLElement).style.display).toBe(
            'block',
        );
        expect((document.getElementById('mods-skeleton-2') as HTMLElement).style.display).toBe(
            'block',
        );

        manager.hide('mods', 2);
        expect((document.getElementById('mods-skeleton-1') as HTMLElement).style.display).toBe(
            'none',
        );
    });

    it('toggles loading state on buttons and ignores null buttons', () => {
        const button = document.createElement('button');

        manager.setButtonLoading(button, true);
        expect(button.disabled).toBe(true);
        expect(button.classList.contains('loading')).toBe(true);

        manager.setButtonLoading(button, false);
        expect(button.disabled).toBe(false);
        expect(button.classList.contains('loading')).toBe(false);

        expect(() => manager.setButtonLoading(null, true)).not.toThrow();
        expect(() => manager.show('missing')).not.toThrow();
    });
});
