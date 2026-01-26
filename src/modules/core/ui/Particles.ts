/**
 * @module core/ui/Particles
 * @description Background particles animation for the Flux Platform UI
 */

interface IParticlesGlobal {
    screen: Screen;
}

export class Particles {
    private readonly _canvas: HTMLCanvasElement;
    private readonly _ctx: CanvasRenderingContext2D;
    private _particles: Array<{
        x: number;
        y: number;
        vx: number;
        vy: number;
        size: number;
        color: string;
    }> = [];
    private readonly _mouse: { x: number; y: number } = { x: -100, y: -100 };
    private readonly _width: number = 0;
    private readonly _height: number = 0;
    private _isRunning: boolean = false;
    private _lastFrameTime: number = 0;
    private readonly _cleanupAbort: AbortController = new AbortController();

    constructor() {
        this._canvas = document.createElement('canvas');
        const context = this._canvas.getContext('2d');
        if (!context) {
            throw new Error('Failed to get 2D context');
        }
        this._ctx = context;

        document.body.appendChild(this._canvas);

        this._canvas.style.position = 'fixed';
        this._canvas.style.top = '0';
        this._canvas.style.left = '0';
        this._canvas.style.width = '100%';
        this._canvas.style.height = '100%';
        this._canvas.style.pointerEvents = 'none';
        this._canvas.style.zIndex = '-1';

        // Use actual screen size + 20% buffer
        const g = globalThis as unknown as IParticlesGlobal;
        const sW = g.screen.width;
        const sH = g.screen.height;
        const maxDim = Math.max(sW, sH) * 1.2;
        this._width = maxDim;
        this._height = maxDim;

        this._canvas.width = this._width * 0.5;
        this._canvas.height = this._height * 0.5;
        this._canvas.style.width = this._width + 'px';
        this._canvas.style.height = this._height + 'px';

        this._ctx.scale(0.5, 0.5);

        this._init();
        this._bindEvents();
        this.start();
    }

    /**
     * Cleans up the canvas and aborts event listeners.
     * @sideeffect Removes canvas from body and clears particle array
     */
    public destroy(): void {
        this.stop();
        this._cleanupAbort.abort();
        this._canvas.remove();
        this._particles = [];
    }

    private _init(): void {
        const density = 30000;
        const particleCount = Math.floor((this._width * this._height) / density);

        for (let i = 0; i < particleCount; i++) {
            this._particles.push({
                x: this._random() * this._width,
                y: this._random() * this._height,
                vx: (this._random() - 0.5) * 0.2,
                vy: (this._random() - 0.5) * 0.2,
                size: this._random() * 2 + 0.5,
                color: this._random() > 0.5 ? 'rgba(138, 43, 226, 0.3)' : 'rgba(93, 220, 255, 0.3)',
            });
        }
    }

    private _random(): number {
        const buffer = new Uint32Array(1);
        crypto.getRandomValues(buffer);
        return buffer[0] / (0xffffffff + 1);
    }

    /**
     * Binds window/document events for visibility and mouse tracking.
     * @sideeffect Adds global visibility and focus listeners
     */
    private _bindEvents(): void {
        const signal = this._cleanupAbort.signal;

        document.addEventListener(
            'visibilitychange',
            () => {
                if (document.hidden) {
                    this.stop();
                } else {
                    this._checkReducedMotionAndStart();
                }
            },
            { signal },
        );

        globalThis.addEventListener('blur', () => this.stop(), { signal });
        globalThis.addEventListener('focus', () => this._checkReducedMotionAndStart(), { signal });

        globalThis.addEventListener(
            'mousemove',
            (e) => {
                this._mouse.x = e.clientX;
                this._mouse.y = e.clientY;
            },
            { signal },
        );

        // Reduced Motion Listener (Section 30.3)
        const motionQuery = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
        const handleMotion = (): void => {
            if (motionQuery.matches) this.stop();
            else this.start();
        };
        motionQuery.addEventListener('change', handleMotion, { signal });
        handleMotion(); // Initial check
    }

    private _checkReducedMotionAndStart(): void {
        const motionQuery = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
        if (!motionQuery.matches) {
            this.start();
        }
    }

    public start(): void {
        if (!this._isRunning) {
            const motionQuery = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
            if (motionQuery.matches) return;

            this._isRunning = true;
            this._lastFrameTime = performance.now();
            this._animate();
        }
    }

    public stop(): void {
        this._isRunning = false;
    }

    /**
     * Batched rendering logic to minimize draw calls (Section 14.1).
     */
    private _animate(): void {
        if (!this._isRunning) return;

        const now = performance.now();
        const elapsed = now - this._lastFrameTime;

        // Cap to roughly 60FPS for smoothness
        if (elapsed > 16) {
            this._lastFrameTime = now - (elapsed % 16);
            this._ctx.clearRect(0, 0, this._width, this._height);

            // Group by color for batching
            const groups: Record<string, typeof this._particles> = {};

            this._particles.forEach((p) => {
                p.x += p.vx;
                p.y += p.vy;

                const dx = this._mouse.x - p.x;
                const dy = this._mouse.y - p.y;
                const dist = Math.hypot(dx, dy);
                const maxDist = 150;

                if (dist < maxDist) {
                    const force = (maxDist - dist) / maxDist;
                    const angle = Math.atan2(dy, dx);
                    p.vx -= Math.cos(angle) * force * 0.05;
                    p.vy -= Math.sin(angle) * force * 0.05;
                }

                if (p.x < 0) p.x = this._width;
                if (p.x > this._width) p.x = 0;
                if (p.y < 0) p.y = this._height;
                if (p.y > this._height) p.y = 0;

                if (!groups[p.color]) groups[p.color] = [];
                groups[p.color].push(p);
            });

            // Batch Draw
            Object.entries(groups).forEach(([color, pts]) => {
                this._ctx.fillStyle = color;
                this._ctx.beginPath();
                pts.forEach((p) => {
                    this._ctx.moveTo(p.x + p.size, p.y);
                    this._ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                });
                this._ctx.fill();
            });
        }

        requestAnimationFrame(() => this._animate());
    }
}
