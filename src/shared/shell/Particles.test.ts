import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Particles } from './Particles';

describe('Particles', () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalMatchMedia = globalThis.matchMedia;

    beforeEach(() => {
        document.body.innerHTML = '';

        Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 1200 });
        Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 800 });
        Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
        Object.defineProperty(globalThis, 'screen', {
            configurable: true,
            value: { width: 1200, height: 800 },
        });

        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
            configurable: true,
            value: vi.fn(() => {
                return {
                    clearRect: vi.fn(),
                    fillRect: vi.fn(),
                    fillStyle: '',
                } as unknown as CanvasRenderingContext2D;
            }),
        });

        globalThis.requestAnimationFrame = vi.fn(() => 1);
        globalThis.matchMedia = vi.fn().mockImplementation(() => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })) as typeof globalThis.matchMedia;
    });

    afterEach(() => {
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
            configurable: true,
            value: originalGetContext,
        });
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        globalThis.matchMedia = originalMatchMedia;
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('builds particles from the viewport and rebuilds them after resize', () => {
        const particles = new Particles();
        const initialCount = (particles as unknown as { _particles: unknown[] })._particles.length;
        const initialWorldWidth = (particles as unknown as { _worldWidth: number })._worldWidth;

        expect(initialCount).toBe(Math.floor((1200 * 800) / 25000));
        expect(initialWorldWidth).toBe(1200 + Math.max(32, Math.round(1200 * 0.1)) * 2);

        Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 1600 });
        Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 900 });
        globalThis.dispatchEvent(new Event('resize'));

        const resizedCount = (particles as unknown as { _particles: unknown[] })._particles.length;
        const resizedWorldWidth = (particles as unknown as { _worldWidth: number })._worldWidth;

        expect(resizedCount).toBe(Math.floor((1600 * 900) / 25000));
        expect(resizedWorldWidth).toBe(1600 + Math.max(32, Math.round(1600 * 0.1)) * 2);

        particles.destroy();
    });

    it('hides the canvas outside Tauri runtime', () => {
        delete (globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

        const particles = new Particles();
        const canvas = document.querySelector('canvas');

        expect(canvas).not.toBeNull();
        expect((canvas as HTMLCanvasElement).style.display).toBe('none');

        particles.destroy();
        (globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    });
});
