/**
 * @module core/services/SoundService
 * @description Provides audio feedback for UI interactions
 */

// Local types for global access
interface ISoundGlobal {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
}

export class SoundService {
    private _ctx: AudioContext | null = null;
    private _enabled = true;
    private _lastHovered: Element | null = null;
    private _unsubscribers: (() => void)[] = [];
    private _currentBadge: Element | null = null;
    private _currentActionCorner: Element | null = null;

    constructor() {
        this._initContext();
        this._bindListeners();
    }

    /**
     * Initializes the AudioContext.
     */
    private _initContext(): void {
        try {
            const win = globalThis as unknown as ISoundGlobal;
            const AudioContextClass = win.AudioContext || win.webkitAudioContext;
            if (AudioContextClass) {
                this._ctx = new AudioContextClass();
            }
        } catch {
            console.warn('[SoundService] AudioContext not available');
        }
    }

    /**
     * Cleans up all event listeners and audio context.
     */
    public destroy(): void {
        this._unsubscribers.forEach(fn => fn());
        this._unsubscribers = [];
        
        if (this._ctx && this._ctx.state !== 'closed') {
            this._ctx.close().catch(e => console.error('[SoundService] Error closing context:', e));
        }
        
        console.debug('[SoundService] Destroyed.');
    }

    /**
     * Enable or disable sound effects.
     */
    public setEnabled(enabled: boolean): void {
        this._enabled = enabled;
    }

    /**
     * Returns whether sound effects are enabled.
     */
    public isEnabled(): boolean {
        return this._enabled;
    }

    /**
     * Plays a single tone.
     */
    private _playTone(freq: number, type: OscillatorType, duration: number, vol: number = 0.05): void {
        if (!this._enabled || !this._ctx) return;
        if (this._ctx.state === 'suspended') {
            this._ctx.resume().catch(() => { /* Ignore suspended resume failures */ });
        }

        const osc = this._ctx.createOscillator();
        const gain = this._ctx.createGain();
        const filter = this._ctx.createBiquadFilter();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this._ctx.currentTime);

        // Muffle the sound (Low-pass filter)
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(400, this._ctx.currentTime);

        // Lower volume
        gain.gain.setValueAtTime(vol * 0.5, this._ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + duration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this._ctx.destination);

        osc.start();
        osc.stop(this._ctx.currentTime + duration);
    }

    /**
     * Plays a high-tech subtle 'blip' for hover.
     */
    public playHover(): void {
        this._playTone(600, 'sine', 0.05, 0.004);
    }

    /**
     * Plays an underwater/muffled click sound.
     */
    public playClick(): void {
        if (!this._enabled || !this._ctx) return;
        if (this._ctx.state === 'suspended') {
            this._ctx.resume().catch(() => { /* Ignore */ });
        }

        const t = this._ctx.currentTime;

        const osc = this._ctx.createOscillator();
        const gain = this._ctx.createGain();
        const filter = this._ctx.createBiquadFilter();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(100, t + 0.1);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, t);

        gain.gain.setValueAtTime(0.0025, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this._ctx.destination);

        osc.start();
        osc.stop(t + 0.1);
    }

    /**
     * Plays a rising or falling toggle sound.
     */
    public playToggle(state: boolean): void {
        if (!this._enabled || !this._ctx) return;
        if (this._ctx.state === 'suspended') {
            this._ctx.resume().catch(() => { /* Ignore */ });
        }

        const osc = this._ctx.createOscillator();
        const gain = this._ctx.createGain();

        osc.connect(gain);
        gain.connect(this._ctx.destination);

        const now = this._ctx.currentTime;
        if (state) {
            // Rising pitch (ON)
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.linearRampToValueAtTime(600, now + 0.15);
        } else {
            // Falling pitch (OFF)
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.linearRampToValueAtTime(200, now + 0.15);
        }

        gain.gain.setValueAtTime(0.005, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        osc.start();
        osc.stop(now + 0.15);
    }

    /**
     * Plays a soft expand/collapse sound.
     */
    public playExpand(expanding: boolean): void {
        if (!this._enabled || !this._ctx) return;
        if (this._ctx.state === 'suspended') {
            this._ctx.resume().catch(() => { /* Ignore */ });
        }

        const osc = this._ctx.createOscillator();
        const gain = this._ctx.createGain();
        const filter = this._ctx.createBiquadFilter();

        osc.type = 'sine';
        const t = this._ctx.currentTime;

        if (expanding) {
            osc.frequency.setValueAtTime(400, t);
            osc.frequency.linearRampToValueAtTime(700, t + 0.08);
        } else {
            osc.frequency.setValueAtTime(700, t);
            osc.frequency.linearRampToValueAtTime(400, t + 0.08);
        }

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, t);

        // Normalized volume
        gain.gain.setValueAtTime(0.005, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this._ctx.destination);

        osc.start();
        osc.stop(t + 0.08);
    }

    /**
     * Binds mouse events to trigger sound effects.
     */
    private _bindListeners(): void {
        // 1. Mouse Over (Hover & Expansion)
        const handleMouseOver = (e: Event): void => {
            const target = (e.target as Element).closest('button, .nav-btn, .toggle, .sidebar-toggle-btn, .taskbar-toggle-btn, .taskbar-toggle-item, .monitor-toggle-btn, .action-btn-small, .model-card-action, .app-card, .model-card-premium, .card-action-corner, .ai-model-card, .thinking-option-card, .ai-check-btn, .ai-icon-btn');

            if (target) {
                if (target !== this._lastHovered) {
                    this.playHover();
                    this._lastHovered = target;
                }
            } else {
                this._lastHovered = null;
            }

            // Badge/Corner expansion sounds
            if (e.target instanceof Element) {
                this._handleExpansionSounds(e.target);
            }
        };

        // 2. Mouse Out
        const handleMouseOut = (e: Event): void => {
            const ev = e as MouseEvent;
            if (ev.relatedTarget === null) {
                this._lastHovered = null;
            }
        };

        // 3. Mouse Down (Click)
        const handleMouseDown = (e: Event): void => {
            if ((e.target as HTMLElement).closest('button, .nav-btn, .toggle, .taskbar-toggle-item, .monitor-toggle-btn, .action-btn-small, .model-card-action, .app-card, .model-card-premium, .card-action-corner, .ai-model-card, .thinking-option-card, .ai-check-btn, .ai-icon-btn')) {
                this.playClick();
            }
        };

        document.addEventListener('mouseover', handleMouseOver);
        document.addEventListener('mouseout', handleMouseOut);
        document.addEventListener('mousedown', handleMouseDown);

        this._unsubscribers.push(
            () => document.removeEventListener('mouseover', handleMouseOver),
            () => document.removeEventListener('mouseout', handleMouseOut),
            () => document.removeEventListener('mousedown', handleMouseDown)
        );
    }

    /**
     * Handles expansion sounds for UI components.
     */
    private _handleExpansionSounds(target: Element): void {
         // 1. App Badges
         const badge = target.closest('.app-type-badge, .app-delete-badge, .module-type-badge, .module-action-badge');
         if (badge && badge !== this._currentBadge) {
             this._currentBadge = badge;
             this.playExpand(true);
         } else if (!badge && this._currentBadge) {
             this.playExpand(false);
             this._currentBadge = null;
         }

         // 2. Action Corners
         const corner = target.closest('.card-action-corner');
         if (corner && corner !== this._currentActionCorner) {
             this._currentActionCorner = corner;
             this.playExpand(true);
         } else if (!corner && this._currentActionCorner) {
             this.playExpand(false);
             this._currentActionCorner = null;
         }
    }
}
