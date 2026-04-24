type WindowUiShellElements = {
    splash: HTMLElement | null;
    soundToggle: HTMLElement | null;
};

type WindowUiShellDeps = {
    getElements: () => WindowUiShellElements;
};

const SPLASH_FADE_OUT_DELAY_MS = 180;

export class WindowUiShellController {
    constructor(private readonly _deps: WindowUiShellDeps) {}

    public suppressNativeTooltips(signal: AbortSignal): void {
        const handler = (): void => {
            this._moveTitlesToDataset(document.querySelectorAll('[title]'));
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', handler, { signal });
        } else {
            handler();
        }

        document.addEventListener(
            'mouseover',
            (event: Event) => {
                let target = event.target as HTMLElement | null;
                while (target !== null && target !== document.body) {
                    this._moveTitleToDataset(target);
                    target = target.parentElement;
                }
            },
            { passive: true, signal },
        );
    }

    public updateSoundUi(enabled: boolean): void {
        const soundToggle = this._deps.getElements().soundToggle;
        if (soundToggle === null) {
            return;
        }

        const use = soundToggle.querySelector('use');
        if (use !== null) {
            use.setAttribute('href', enabled ? '#icon-volume' : '#icon-volume-x');
        }

        soundToggle.classList.toggle('muted', !enabled);
    }

    public updateWidthWarning(): void {
        document.body.classList.remove('ui-hidden');
    }

    public hideSplashScreen(schedule: (callback: () => void, delayMs: number) => void): void {
        const splash = this._deps.getElements().splash;
        const revealLayout = (): void => {
            this._showLayoutSections(['sidebar', 'app-header', 'main-area']);
            document.body.classList.remove('no-overflow');
        };

        if (splash === null || splash.classList.contains('hidden')) {
            revealLayout();
            return;
        }

        if (splash.classList.contains('fade-out')) {
            return;
        }

        splash.classList.add('fade-out');
        schedule(() => {
            const currentSplash = this._deps.getElements().splash;
            if (currentSplash !== null) {
                currentSplash.classList.remove('fade-out');
                currentSplash.classList.add('hidden');
            }
            revealLayout();
        }, SPLASH_FADE_OUT_DELAY_MS);
    }

    private _moveTitlesToDataset(elements: NodeListOf<Element>): void {
        elements.forEach((element) => {
            this._moveTitleToDataset(element);
        });
    }

    private _moveTitleToDataset(element: Element): void {
        if (!(element instanceof HTMLElement)) {
            return;
        }

        const title = element.title;
        if (title === '') {
            return;
        }

        element.dataset['title'] = title;
        element.removeAttribute('title');
    }

    private _showLayoutSections(ids: string[]): void {
        ids.forEach((id) => {
            const element = document.getElementById(id);
            if (element instanceof HTMLElement) {
                element.classList.add('visible');
            }
        });
    }
}
