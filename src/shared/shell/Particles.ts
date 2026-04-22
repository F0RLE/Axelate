/**
 * @module core/ui/Particles
 * @description Background particles animation for the Axelate UI
 */

interface IParticlesGlobal {
    screen: Screen;
    __TAURI_INTERNALS__?: unknown;
}

type ParticlesRuntime = {
    isTauriRuntime: () => boolean;
    getViewportSize: () => { width: number; height: number };
    getDevicePixelRatio: () => number;
    addWindowListener: typeof globalThis.addEventListener;
    matchMedia: typeof globalThis.matchMedia;
    requestAnimationFrame: typeof globalThis.requestAnimationFrame;
    cancelAnimationFrame: typeof globalThis.cancelAnimationFrame;
};

function createDefaultParticlesRuntime(): ParticlesRuntime {
    return {
        isTauriRuntime: () => (globalThis as IParticlesGlobal).__TAURI_INTERNALS__ !== undefined,
        getViewportSize: () => ({
            width: globalThis.innerWidth,
            height: globalThis.innerHeight,
        }),
        getDevicePixelRatio: () => globalThis.devicePixelRatio || 1,
        addWindowListener: globalThis.addEventListener.bind(globalThis),
        matchMedia: globalThis.matchMedia.bind(globalThis),
        requestAnimationFrame: globalThis.requestAnimationFrame.bind(globalThis),
        cancelAnimationFrame: globalThis.cancelAnimationFrame.bind(globalThis),
    };
}

export class Particles {
    private static readonly _DENSITY = 25000;
    private static readonly _OVERSCAN_RATIO = 0.1;
    private static readonly _FRAME_INTERVAL_MS = 33;

    private readonly _canvas: HTMLCanvasElement;
    private readonly _ctx: CanvasRenderingContext2D;
    private readonly _isTauriRuntime: boolean;
    private _particles: {
        x: number;
        y: number;
        vx: number;
        vy: number;
        size: number;
        color: string;
    }[] = [];

    // Optimization: Group particles by color during init to avoid per-frame allocation
    private _particlesByColor: Record<
        string,
        {
            x: number;
            y: number;
            vx: number;
            vy: number;
            size: number;
            color: string;
        }[]
    > = {};

    private readonly _mouse: { x: number; y: number } = { x: -100, y: -100 };
    private _worldWidth = 0;
    private _worldHeight = 0;
    private _canvasWidth: number = 0;
    private _canvasHeight: number = 0;
    private _overscanX = 0;
    private _overscanY = 0;
    private _devicePixelRatio = 1;

    private _isRunning = false;
    private _lastFrameTime = 0;
    private _resizeFrameId: number | null = null;
    private readonly _cleanupAbort: AbortController = new AbortController();

    constructor(private readonly _runtime: ParticlesRuntime = createDefaultParticlesRuntime()) {
        this._canvas = document.createElement('canvas');
        this._canvas.className = 'particles-layer';
        this._canvas.setAttribute('aria-hidden', 'true');
        const context = this._canvas.getContext('2d', { alpha: true });
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
        this._canvas.style.zIndex = '0'; /* Visible to backdrop-filter, still behind app UI */

        this._isTauriRuntime = this._runtime.isTauriRuntime();
        this._resize(true);

        if (!this._isTauriRuntime) {
            this._canvas.style.display = 'none';
            return;
        }

        this._bindEvents();
        this.start();
    }

    private _resize(reseedParticles = false): void {
        const previousCanvasWidth = this._canvasWidth;
        const previousCanvasHeight = this._canvasHeight;
        const previousWorldWidth = this._worldWidth;
        const previousWorldHeight = this._worldHeight;
        const previousOverscanX = this._overscanX;
        const previousOverscanY = this._overscanY;
        const dpr = this._runtime.getDevicePixelRatio();
        const viewport = this._runtime.getViewportSize();
        const nextCanvasWidth = Math.round(viewport.width * dpr);
        const nextCanvasHeight = Math.round(viewport.height * dpr);
        const canvasChanged =
            nextCanvasWidth !== this._canvasWidth || nextCanvasHeight !== this._canvasHeight;
        const dprChanged = dpr !== this._devicePixelRatio;

        this._devicePixelRatio = dpr;
        this._canvasWidth = nextCanvasWidth;
        this._canvasHeight = nextCanvasHeight;
        if (canvasChanged || dprChanged) {
            this._canvas.width = this._canvasWidth;
            this._canvas.height = this._canvasHeight;
        }

        const nextOverscanX = Math.max(
            32,
            Math.round(this._canvasWidth * Particles._OVERSCAN_RATIO),
        );
        const nextOverscanY = Math.max(
            32,
            Math.round(this._canvasHeight * Particles._OVERSCAN_RATIO),
        );
        const worldChanged =
            nextOverscanX !== this._overscanX ||
            nextOverscanY !== this._overscanY ||
            this._worldWidth !== this._canvasWidth + nextOverscanX * 2 ||
            this._worldHeight !== this._canvasHeight + nextOverscanY * 2;

        this._overscanX = nextOverscanX;
        this._overscanY = nextOverscanY;
        this._worldWidth = this._canvasWidth + this._overscanX * 2;
        this._worldHeight = this._canvasHeight + this._overscanY * 2;

        if (!this._isTauriRuntime || (!reseedParticles && !canvasChanged && !dprChanged && !worldChanged)) {
            return;
        }

        if (this._particles.length === 0 || reseedParticles || previousWorldWidth <= 0 || previousWorldHeight <= 0) {
            this._init();
            return;
        }

        this._reflowParticles({
            previousCanvasWidth,
            previousCanvasHeight,
            previousWorldWidth,
            previousWorldHeight,
            previousOverscanX,
            previousOverscanY,
        });
        this._syncParticlePopulation();
    }

    /**
     * Cleans up the canvas and aborts event listeners.
     */
    public destroy(): void {
        this.stop();
        this._cleanupAbort.abort();
        if (this._resizeFrameId !== null) {
            this._runtime.cancelAnimationFrame(this._resizeFrameId);
            this._resizeFrameId = null;
        }
        this._canvas.remove();
        this._particles = [];
        this._particlesByColor = {};
    }

    private _init(): void {
        const particleCount = Math.max(
            1,
            Math.floor((this._canvasWidth * this._canvasHeight) / Particles._DENSITY),
        );

        // Clear existing
        this._particles = [];
        this._particlesByColor = {};

        for (let i = 0; i < particleCount; i++) {
            this._pushParticle(this._createParticle());
        }
    }

    private _random(): number {
        const buffer = new Uint32Array(1);
        crypto.getRandomValues(buffer);
        return (buffer[0] ?? 0) / (0xffffffff + 1);
    }

    private _bindEvents(): void {
        const signal = this._cleanupAbort.signal;

        // Handle zoom/dpr changes
        this._runtime.addWindowListener(
            'resize',
            () => {
                this._scheduleResize();
            },
            { signal },
        );

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

        this._runtime.addWindowListener(
            'blur',
            () => {
                this.stop();
            },
            { signal },
        );
        this._runtime.addWindowListener(
            'focus',
            () => {
                this._checkReducedMotionAndStart();
            },
            { signal },
        );

        this._runtime.addWindowListener(
            'mousemove',
            (e) => {
                const dpr = this._runtime.getDevicePixelRatio();
                // Convert mouse to physical coordinates
                this._mouse.x = e.clientX * dpr;
                this._mouse.y = e.clientY * dpr;
            },
            { signal },
        );

        const motionQuery = this._runtime.matchMedia('(prefers-reduced-motion: reduce)');
        const handleMotion = (): void => {
            if (motionQuery.matches) this.stop();
            else this.start();
        };
        motionQuery.addEventListener('change', handleMotion, { signal });
        handleMotion(); // Initial check
    }

    private _scheduleResize(): void {
        if (this._resizeFrameId !== null) {
            this._runtime.cancelAnimationFrame(this._resizeFrameId);
        }

        this._resizeFrameId = this._runtime.requestAnimationFrame(() => {
            this._resizeFrameId = null;
            this._resize(false);
        });
    }

    private _checkReducedMotionAndStart(): void {
        const motionQuery = this._runtime.matchMedia('(prefers-reduced-motion: reduce)');
        if (!motionQuery.matches) {
            this.start();
        }
    }

    public start(): void {
        if (!this._isRunning) {
            const motionQuery = this._runtime.matchMedia('(prefers-reduced-motion: reduce)');
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
     * Batched rendering logic with Zero-Allocation strategy.
     */
    private _animate(): void {
        if (!this._isRunning) return;

        const now = performance.now();
        const elapsed = now - this._lastFrameTime;

        // Cap to roughly 30FPS to cut continuous idle GPU/Main load.
        if (elapsed > Particles._FRAME_INTERVAL_MS) {
            this._lastFrameTime = now - (elapsed % Particles._FRAME_INTERVAL_MS);

            // Clear entire buffer
            this._ctx.clearRect(0, 0, this._canvasWidth, this._canvasHeight);

            // Optimization: Iterate over pre-grouped arrays.
            for (const color in this._particlesByColor) {
                const group = this._particlesByColor[color];
                if (!group) continue;

                this._ctx.fillStyle = color;

                // Use for-of loop (cleaner and avoids index checks)
                for (const p of group) {
                    this._updateParticle(p);
                    if (
                        p.x + p.size < 0 ||
                        p.y + p.size < 0 ||
                        p.x > this._canvasWidth ||
                        p.y > this._canvasHeight
                    ) {
                        continue;
                    }

                    // Draw at physical coordinates (No Scaling)
                    // Because canvas is sized to physical pixels and P is stored in physical pixels.
                    this._ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
                }
            }
        }

        this._runtime.requestAnimationFrame(() => {
            this._animate();
        });
    }

    private _createParticle(): {
        x: number;
        y: number;
        vx: number;
        vy: number;
        size: number;
        color: string;
    } {
        let color = 'rgba(255, 255, 255, 0.1)';
        const rand = this._random();

        if (rand > 0.6) {
            color = 'rgba(138, 43, 226, 0.4)';
        } else if (rand > 0.5) {
            color = 'rgba(147, 51, 234, 0.3)';
        }

        return {
            x: this._random() * this._worldWidth - this._overscanX,
            y: this._random() * this._worldHeight - this._overscanY,
            vx: (this._random() - 0.5) * 0.1,
            vy: (this._random() - 0.5) * 0.1,
            size: Math.floor(this._random() * 3) + 2,
            color,
        };
    }

    private _pushParticle(particle: {
        x: number;
        y: number;
        vx: number;
        vy: number;
        size: number;
        color: string;
    }): void {
        this._particles.push(particle);

        let group = this._particlesByColor[particle.color];
        if (!group) {
            group = [];
            this._particlesByColor[particle.color] = group;
        }
        group.push(particle);
    }

    private _reflowParticles(previous: {
        previousCanvasWidth: number;
        previousCanvasHeight: number;
        previousWorldWidth: number;
        previousWorldHeight: number;
        previousOverscanX: number;
        previousOverscanY: number;
    }): void {
        for (const particle of this._particles) {
            const normalizedX =
                (particle.x + previous.previousOverscanX) / previous.previousWorldWidth;
            const normalizedY =
                (particle.y + previous.previousOverscanY) / previous.previousWorldHeight;

            particle.x = normalizedX * this._worldWidth - this._overscanX;
            particle.y = normalizedY * this._worldHeight - this._overscanY;
        }

        const mouseScaleX =
            previous.previousCanvasWidth > 0 ? this._canvasWidth / previous.previousCanvasWidth : 1;
        const mouseScaleY =
            previous.previousCanvasHeight > 0 ? this._canvasHeight / previous.previousCanvasHeight : 1;
        this._mouse.x *= mouseScaleX;
        this._mouse.y *= mouseScaleY;
    }

    private _syncParticlePopulation(): void {
        const targetCount = Math.max(
            1,
            Math.floor((this._canvasWidth * this._canvasHeight) / Particles._DENSITY),
        );

        while (this._particles.length < targetCount) {
            this._pushParticle(this._createParticle());
        }

        if (this._particles.length <= targetCount) {
            return;
        }

        const keep = this._particles.slice(0, targetCount);
        this._particles = keep;
        this._particlesByColor = {};

        for (const particle of keep) {
            this._pushParticleToGroup(particle);
        }
    }

    private _pushParticleToGroup(particle: {
        x: number;
        y: number;
        vx: number;
        vy: number;
        size: number;
        color: string;
    }): void {
        let group = this._particlesByColor[particle.color];
        if (!group) {
            group = [];
            this._particlesByColor[particle.color] = group;
        }
        group.push(particle);
    }

    private _updateParticle(p: {
        x: number;
        y: number;
        vx: number;
        vy: number;
        size: number;
        color: string;
    }): void {
        // Physics Update (Physical Coordinates)
        p.x += p.vx;
        p.y += p.vy;

        // Mouse interaction
        const dx = this._mouse.x - p.x;
        const dy = this._mouse.y - p.y;

        // Interaction radius (Physical Pixels)
        const radius = 150 * this._devicePixelRatio;

        if (Math.abs(dx) < radius && Math.abs(dy) < radius) {
            const dist = Math.hypot(dx, dy);
            if (dist < radius) {
                const force = (radius - dist) / radius;
                const angle = Math.atan2(dy, dx);
                p.vx -= Math.cos(angle) * force * 0.05;
                p.vy -= Math.sin(angle) * force * 0.05;
            }
        }

        // Wrap around screen (Physical Dimensions)
        if (p.x < -this._overscanX) p.x = this._canvasWidth + this._overscanX;
        else if (p.x > this._canvasWidth + this._overscanX) p.x = -this._overscanX;

        if (p.y < -this._overscanY) p.y = this._canvasHeight + this._overscanY;
        else if (p.y > this._canvasHeight + this._overscanY) p.y = -this._overscanY;
    }
}
