import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkeletonManager } from './SkeletonManager';

vi.mock('@/shared/utils/globalAccessor', () => ({
    getGlobalWin: vi.fn(() => globalThis),
}));

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
        delete (globalThis as { showSkeletonLoaders?: unknown }).showSkeletonLoaders;
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

    it('uses legacy global hook when available', () => {
        const showSkeletonLoaders = vi.fn();
        (
            globalThis as unknown as { showSkeletonLoaders?: typeof showSkeletonLoaders }
        ).showSkeletonLoaders = showSkeletonLoaders;

        manager.show('mods', 3);
        expect(showSkeletonLoaders).toHaveBeenCalledWith('mods', 3);
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
