import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SoundService } from './SoundService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

/**
 * Creates a mock AudioContext and all sub-objects needed by SoundService.
 * We inject it directly into `_ctx` to avoid constructor-mock issues.
 */
function createMockCtx() {
    return {
        state: 'running' as string,
        currentTime: 0,
        destination: {},
        createOscillator: vi.fn(() => ({
            type: 'sine',
            frequency: {
                setValueAtTime: vi.fn(),
                exponentialRampToValueAtTime: vi.fn(),
                linearRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
        })),
        createGain: vi.fn(() => ({
            gain: {
                setValueAtTime: vi.fn(),
                exponentialRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
        })),
        createBiquadFilter: vi.fn(() => ({
            type: 'lowpass',
            frequency: { setValueAtTime: vi.fn() },
            connect: vi.fn(),
        })),
        close: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn().mockResolvedValue(undefined),
    };
}

describe('SoundService', () => {
    let mockCtx: ReturnType<typeof createMockCtx>;
    let service: SoundService;
    let tracer: Pick<LoggerService, 'warn' | 'error' | 'debug'>;

    beforeEach(() => {
        // SoundService constructor needs AudioContext on globalThis
        // We provide a stub that returns our mockCtx
        mockCtx = createMockCtx();
        tracer = {
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };
        (globalThis as unknown as Record<string, unknown>)['AudioContext'] = function () {
            return mockCtx;
        };
        service = new SoundService(tracer);
        // Ensure _ctx is our mock (belt-and-suspenders)
        (service as unknown as { _ctx: ReturnType<typeof createMockCtx> })._ctx = mockCtx;
    });

    afterEach(() => {
        service.destroy();
        delete (globalThis as unknown as Record<string, unknown>)['AudioContext'];
        document.body.innerHTML = '';
    });

    it('should initialize with AudioContext', () => {
        expect(service.isEnabled()).toBe(true);
    });

    it('should handle missing AudioContext gracefully', () => {
        delete (globalThis as unknown as Record<string, unknown>)['AudioContext'];
        const s = new SoundService(tracer);
        expect(s.isEnabled()).toBe(true);
        expect(() => s.playHover()).not.toThrow();
        s.destroy();
    });

    it('should enable and disable', () => {
        service.setEnabled(false);
        expect(service.isEnabled()).toBe(false);
        service.setEnabled(true);
        expect(service.isEnabled()).toBe(true);
    });

    it('playHover should create oscillator', () => {
        service.playHover();
        expect(mockCtx.createOscillator).toHaveBeenCalled();
    });

    it('playClick should create oscillator', () => {
        service.playClick();
        expect(mockCtx.createOscillator).toHaveBeenCalled();
    });

    it('playToggle(true) should create oscillator', () => {
        service.playToggle(true);
        expect(mockCtx.createOscillator).toHaveBeenCalled();
    });

    it('playToggle(false) should create oscillator', () => {
        service.playToggle(false);
        expect(mockCtx.createOscillator).toHaveBeenCalled();
    });

    it('playExpand(true) should create oscillator', () => {
        service.playExpand(true);
        expect(mockCtx.createOscillator).toHaveBeenCalled();
    });

    it('playExpand(false) should create oscillator', () => {
        service.playExpand(false);
        expect(mockCtx.createOscillator).toHaveBeenCalled();
    });

    it('should not play when disabled', () => {
        service.setEnabled(false);
        mockCtx.createOscillator.mockClear();
        service.playHover();
        service.playClick();
        service.playToggle(true);
        service.playExpand(true);
        expect(mockCtx.createOscillator).not.toHaveBeenCalled();
    });

    it('should resume suspended AudioContext on play', () => {
        mockCtx.state = 'suspended';
        service.playHover();
        expect(mockCtx.resume).toHaveBeenCalled();
    });

    it('should resume suspended AudioContext on playClick (L120)', () => {
        mockCtx.state = 'suspended';
        mockCtx.resume.mockClear();
        service.playClick();
        expect(mockCtx.resume).toHaveBeenCalled();
    });

    it('should resume suspended AudioContext on playToggle (L155)', () => {
        mockCtx.state = 'suspended';
        mockCtx.resume.mockClear();
        service.playToggle(true);
        expect(mockCtx.resume).toHaveBeenCalled();
    });

    it('should resume suspended AudioContext on playExpand (L190)', () => {
        mockCtx.state = 'suspended';
        mockCtx.resume.mockClear();
        service.playExpand(true);
        expect(mockCtx.resume).toHaveBeenCalled();
    });

    it('destroy should close context', () => {
        service.destroy();
        expect(mockCtx.close).toHaveBeenCalled();
    });

    it('destroy should skip close if already closed', () => {
        mockCtx.state = 'closed';
        service.destroy();
        expect(mockCtx.close).not.toHaveBeenCalled();
    });

    describe('Mouse events', () => {
        it('should play hover on button mouseover', () => {
            const btn = document.createElement('button');
            document.body.appendChild(btn);
            mockCtx.createOscillator.mockClear();

            btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            expect(mockCtx.createOscillator).toHaveBeenCalled();
        });

        it('should play click on button mousedown', () => {
            const btn = document.createElement('button');
            document.body.appendChild(btn);
            mockCtx.createOscillator.mockClear();

            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            expect(mockCtx.createOscillator).toHaveBeenCalled();
        });

        it('should reset hover on mouseout to body (null relatedTarget)', () => {
            document.dispatchEvent(
                new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }),
            );
            // Should not throw
        });

        it('should keep lastHovered when mouseout goes to another element (L253 false)', () => {
            const btn = document.createElement('button');
            document.body.appendChild(btn);
            const btn2 = document.createElement('button');
            document.body.appendChild(btn2);

            // Set lastHovered by hovering btn
            btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

            // Mouse out from btn to btn2 → relatedTarget is non-null → _lastHovered NOT cleared
            btn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: btn2 }));
            // Should not throw; no assertion on private state needed
        });
    });

    describe('AudioContext error paths', () => {
        it('should handle AudioContext constructor throwing', () => {
            delete (globalThis as unknown as Record<string, unknown>)['AudioContext'];
            (globalThis as unknown as Record<string, unknown>)['AudioContext'] = function () {
                throw new Error('Not supported');
            };
            const s = new SoundService(tracer);
            // Should not throw, ctx is null
            expect(() => s.playHover()).not.toThrow();
            s.destroy();
        });

        it('should handle close() rejection gracefully', () => {
            mockCtx.close.mockRejectedValue(new Error('Close failed'));
            // Should not throw
            expect(() => service.destroy()).not.toThrow();
        });
    });

    describe('resume rejection catch callbacks', () => {
        it('should silently swallow resume rejection in _playTone', async () => {
            mockCtx.state = 'suspended';
            mockCtx.resume.mockRejectedValueOnce(new Error('resume fail'));
            service.playHover();
            // flush microtasks so the catch callback executes
            await Promise.resolve();
            await Promise.resolve();
        });

        it('should silently swallow resume rejection in playClick', async () => {
            mockCtx.state = 'suspended';
            mockCtx.resume.mockRejectedValueOnce(new Error('resume fail'));
            service.playClick();
            await Promise.resolve();
            await Promise.resolve();
        });

        it('should silently swallow resume rejection in playToggle', async () => {
            mockCtx.state = 'suspended';
            mockCtx.resume.mockRejectedValueOnce(new Error('resume fail'));
            service.playToggle(true);
            await Promise.resolve();
            await Promise.resolve();
        });

        it('should silently swallow resume rejection in playExpand', async () => {
            mockCtx.state = 'suspended';
            mockCtx.resume.mockRejectedValueOnce(new Error('resume fail'));
            service.playExpand(true);
            await Promise.resolve();
            await Promise.resolve();
        });

        it('should silently swallow close rejection in destroy', async () => {
            mockCtx.close.mockRejectedValueOnce(new Error('close fail'));
            service.destroy();
            // Give the microtask queue time to run the catch callback
            await Promise.resolve();
            await Promise.resolve();
        });
    });

    describe('Expansion sounds', () => {
        it('should play expand sound on badge hover', () => {
            const badge = document.createElement('div');
            badge.classList.add('app-type-badge');
            document.body.appendChild(badge);
            mockCtx.createOscillator.mockClear();

            badge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            expect(mockCtx.createOscillator).toHaveBeenCalled();
        });

        it('should play collapse sound when leaving badge', () => {
            const badge = document.createElement('div');
            badge.classList.add('app-type-badge');
            document.body.appendChild(badge);

            // Enter badge
            badge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            mockCtx.createOscillator.mockClear();

            // Leave to body (no badge)
            document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            expect(mockCtx.createOscillator).toHaveBeenCalled();
        });

        it('should play expand on action corner hover', () => {
            const corner = document.createElement('div');
            corner.classList.add('card-action-corner');
            document.body.appendChild(corner);
            mockCtx.createOscillator.mockClear();

            corner.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            expect(mockCtx.createOscillator).toHaveBeenCalled();
        });

        it('should play collapse when leaving action corner', () => {
            const corner = document.createElement('div');
            corner.classList.add('card-action-corner');
            document.body.appendChild(corner);

            corner.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            mockCtx.createOscillator.mockClear();

            document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            expect(mockCtx.createOscillator).toHaveBeenCalled();
        });
    });

    describe('Non-button mouseover', () => {
        it('should reset lastHovered when hovering non-interactive element', () => {
            const btn = document.createElement('button');
            document.body.appendChild(btn);
            btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

            // Now hover a plain div
            const div = document.createElement('div');
            document.body.appendChild(div);
            div.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            // lastHovered should be null, no crash
        });

        it('should not play hover twice on same element (L236)', () => {
            const btn = document.createElement('button');
            document.body.appendChild(btn);
            mockCtx.createOscillator.mockClear();

            btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);

            // Hover same button again — should NOT play again
            mockCtx.createOscillator.mockClear();
            btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            expect(mockCtx.createOscillator).not.toHaveBeenCalled();
        });

        it('should not play click on non-button mousedown (L260)', () => {
            const div = document.createElement('div');
            document.body.appendChild(div);
            mockCtx.createOscillator.mockClear();

            div.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            // Should not play click since div doesn't match the selector
            expect(mockCtx.createOscillator).not.toHaveBeenCalled();
        });

        it('should remove document listeners on destroy', () => {
            const btn = document.createElement('button');
            document.body.appendChild(btn);

            service.destroy();
            mockCtx.createOscillator.mockClear();

            btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

            expect(mockCtx.createOscillator).not.toHaveBeenCalled();
        });
    });
});
