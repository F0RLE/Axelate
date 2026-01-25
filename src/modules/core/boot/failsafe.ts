/**
 * @module core/boot/failsafe
 * @description Failsafe mechanism to ensure the splash screen is hidden if application initialization hangs
 */

export class FailsafeService {
    private _timeoutId: ReturnType<typeof setTimeout> | null = null;
    private readonly TIMEOUT_MS = 15000;

    /**
     * Starts the failsafe timer.
     */
    public init(): void {
        this._timeoutId = setTimeout(() => {
            this._runFailsafe();
        }, this.TIMEOUT_MS);
    }

    /**
     * Cancels the failsafe timer (e.g. if app loaded successfully).
     */
    public cancel(): void {
        if (this._timeoutId) {
            clearTimeout(this._timeoutId);
            this._timeoutId = null;
        }
    }

    /**
     * Forces the UI to show if splash screen is stuck.
     */
    private _runFailsafe(): void {
        const splash = document.getElementById('splash-screen');
        if (!splash) return;

        const computedSplash = globalThis.getComputedStyle(splash);
        const isSplashVisible = computedSplash.display !== 'none' && computedSplash.opacity !== '0' && computedSplash.visibility !== 'hidden';

        if (isSplashVisible) {
            console.warn('[Failsafe] Splash screen timed out, forcing hide.');
            splash.classList.add('fade-out');
            splash.style.opacity = '0';

            setTimeout(() => {
                splash.classList.add('hidden');
                splash.style.display = 'none';
                document.body.classList.remove('no-overflow');

                // Show main UI if it's still hidden
                const elements = ['sidebar', 'app-header', 'main-area'];
                elements.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.classList.add('visible');
                        el.style.opacity = '1';
                    }
                });
            }, 500);
        }
    }
}

// Auto-start for boot module
export const failsafe = new FailsafeService();
failsafe.init();
