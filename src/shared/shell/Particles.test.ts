import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Particles } from './Particles';

describe('Particles', () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
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

        (globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
        let frameId = 0;
        globalThis.requestAnimationFrame = vi.fn(() => {
            frameId += 1;
            return frameId;
        });
        globalThis.cancelAnimationFrame = vi.fn();
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
        globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
        globalThis.matchMedia = originalMatchMedia;
        delete (globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('reflows particles on resize without rebuilding the whole background', () => {
        const particles = new Particles();
        const initialParticles = (
            particles as unknown as {
                _particles: {
                    x: number;
                    y: number;
                    vx: number;
                    vy: number;
                    size: number;
                    color: string;
                }[];
            }
        )._particles;
        const initialCount = initialParticles.length;
        const initialWorldWidth = (particles as unknown as { _worldWidth: number })._worldWidth;
        const initialFirstParticle = initialParticles[0];
        expect(initialFirstParticle).toBeDefined();
        if (initialFirstParticle === undefined) {
            throw new Error('Expected first particle to exist');
        }
        const initialFirstParticleX = initialFirstParticle.x;
        const initialFirstParticleY = initialFirstParticle.y;

        expect(initialCount).toBe(Math.floor((1200 * 800) / 25000));
        expect(initialWorldWidth).toBe(1200 + Math.max(32, Math.round(1200 * 0.1)) * 2);

        Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 1600 });
        Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 900 });
        globalThis.dispatchEvent(new Event('resize'));
        const resizeCallback = (
            globalThis.requestAnimationFrame as unknown as ReturnType<typeof vi.fn>
        ).mock.calls.at(-1)?.[0] as FrameRequestCallback | undefined;
        resizeCallback?.(performance.now());

        const resizedParticles = (
            particles as unknown as {
                _particles: {
                    x: number;
                    y: number;
                    vx: number;
                    vy: number;
                    size: number;
                    color: string;
                }[];
            }
        )._particles;
        const resizedCount = resizedParticles.length;
        const resizedWorldWidth = (particles as unknown as { _worldWidth: number })._worldWidth;
        const resizedFirstParticle = resizedParticles[0];
        expect(resizedFirstParticle).toBeDefined();
        if (resizedFirstParticle === undefined) {
            throw new Error('Expected resized first particle to exist');
        }

        expect(resizedCount).toBe(Math.floor((1600 * 900) / 25000));
        expect(resizedWorldWidth).toBe(1600 + Math.max(32, Math.round(1600 * 0.1)) * 2);
        expect(resizedFirstParticle).toBe(initialParticles[0]);
        expect(resizedFirstParticle.color).toBe(initialFirstParticle.color);
        expect(resizedFirstParticle.size).toBe(initialFirstParticle.size);
        expect(resizedFirstParticle.x).not.toBe(initialFirstParticleX);
        expect(resizedFirstParticle.y).not.toBe(initialFirstParticleY);

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

    it('cancels the pending animation frame when stopped before the next frame', () => {
        const particles = new Particles();

        expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);

        particles.stop();
        expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(1);

        particles.start();
        expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(2);

        particles.stop();
        expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(2);

        particles.destroy();
    });

    it('reuses the reduced-motion media query across focus restores', () => {
        const particles = new Particles();
        const matchMediaSpy = globalThis.matchMedia as unknown as ReturnType<typeof vi.fn>;

        expect(matchMediaSpy).toHaveBeenCalledTimes(1);

        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
        globalThis.dispatchEvent(new Event('focus'));
        globalThis.dispatchEvent(new Event('focus'));

        expect(matchMediaSpy).toHaveBeenCalledTimes(1);
        particles.destroy();
    });
});
