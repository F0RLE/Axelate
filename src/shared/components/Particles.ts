/**
 * @module core/ui/Particles
 * @description Background particles animation for the Axelate UI
 */

interface IParticlesGlobal {
    screen: Screen;
}

export class Particles {
    private readonly _canvas: HTMLCanvasElement;
    private readonly _ctx: CanvasRenderingContext2D;
    private _particles: {
        x: number;
        y: number;
        vx: number;
        vy: number;
        size: number;
        color: string;
    }[] = [];
    
    // Optimization: Group particles by color during init to avoid per-frame allocation
    private _particlesByColor: Record<string, {
        x: number;
        y: number;
        vx: number;
        vy: number;
        size: number;
        color: string;
    }[]> = {};

    private readonly _mouse: { x: number; y: number } = { x: -100, y: -100 };
    private readonly _width: number;
    private readonly _height: number;
    // Track canvas size to avoid expensive property access
    private _canvasWidth: number = 0;
    private _canvasHeight: number = 0;
    
    private _isRunning = false;
    private _lastFrameTime = 0;
    private readonly _cleanupAbort: AbortController = new AbortController();

    constructor() {
        this._canvas = document.createElement('canvas');
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
        this._canvas.style.zIndex = '-1'; /* Behind body content */

        // Initialize World to Physical Device Pixels
        const g = globalThis as unknown as IParticlesGlobal;
        const dpr = window.devicePixelRatio || 1;
        const sW = g.screen.width * dpr;
        const sH = g.screen.height * dpr;
        
        // World is +20% larger than physical screen
        const maxDim = Math.max(sW, sH) * 1.2;
        this._width = maxDim;
        this._height = maxDim;

        this._resize();
        
        this._init();
        this._bindEvents();
        this.start();
    }

    private _resize(): void {
        const dpr = window.devicePixelRatio || 1;
        
        // Set canvas buffer to match physical Viewport pixels
        // This ensures 1 canvas pixel = 1 screen pixel regardless of Zoom
        this._canvasWidth = Math.round(window.innerWidth * dpr);
        this._canvasHeight = Math.round(window.innerHeight * dpr);
        
        this._canvas.width = this._canvasWidth;
        this._canvas.height = this._canvasHeight;
    }

    /**
     * Cleans up the canvas and aborts event listeners.
     */
    public destroy(): void {
        this.stop();
        this._cleanupAbort.abort();
        this._canvas.remove();
        this._particles = [];
        this._particlesByColor = {};
    }

    private _init(): void {
        const density = 25000; 
        const particleCount = Math.floor((this._width * this._height) / density);
        
        // Clear existing
        this._particles = [];
        this._particlesByColor = {};

        for (let i = 0; i < particleCount; i++) {
            let color = 'rgba(255, 255, 255, 0.1)'; 
            const rand = this._random();

            if (rand > 0.6) {
                color = 'rgba(138, 43, 226, 0.4)'; 
            } else if (rand > 0.5) {
                color = 'rgba(147, 51, 234, 0.3)'; 
            }

            const p = {
                x: this._random() * this._width,
                y: this._random() * this._height,
                vx: (this._random() - 0.5) * 0.1,
                vy: (this._random() - 0.5) * 0.1,
                size: Math.floor(this._random() * 3) + 2, // Fixed Physical Size
                color: color,
            };

            this._particles.push(p);
            
            let group = this._particlesByColor[color];
            if (!group) {
                group = [];
                this._particlesByColor[color] = group;
            }
            group.push(p);
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
        globalThis.addEventListener('resize', () => {
            this._resize();
        }, { signal });

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

        globalThis.addEventListener(
            'blur',
            () => {
                this.stop();
            },
            { signal },
        );
        globalThis.addEventListener(
            'focus',
            () => {
                this._checkReducedMotionAndStart();
            },
            { signal },
        );

        globalThis.addEventListener(
            'mousemove',
            (e) => {
                const dpr = window.devicePixelRatio || 1;
                // Convert mouse to physical coordinates
                this._mouse.x = e.clientX * dpr;
                this._mouse.y = e.clientY * dpr;
            },
            { signal },
        );

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
     * Batched rendering logic with Zero-Allocation strategy.
     */
    private _animate(): void {
        if (!this._isRunning) return;

        const now = performance.now();
        const elapsed = now - this._lastFrameTime;

        // Cap to roughly 60FPS
        if (elapsed > 16) {
            this._lastFrameTime = now - (elapsed % 16);
            
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
                   // Draw at physical coordinates (No Scaling)
                   // Because canvas is sized to physical pixels and P is stored in physical pixels.
                   this._ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
               }
            }
        }

        requestAnimationFrame(() => {
            this._animate();
        });
    }

    private _updateParticle(p: { x: number; y: number; vx: number; vy: number; size: number; color: string }): void {
        // Physics Update (Physical Coordinates)
        p.x += p.vx;
        p.y += p.vy;

        // Mouse interaction
        const dx = this._mouse.x - p.x;
        const dy = this._mouse.y - p.y;
        
        // Interaction radius (Physical Pixels)
        const radius = 150 * (window.devicePixelRatio || 1);

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
        if (p.x < 0) p.x = this._width;
        else if (p.x > this._width) p.x = 0;
        
        if (p.y < 0) p.y = this._height;
        else if (p.y > this._height) p.y = 0;
    }
}
