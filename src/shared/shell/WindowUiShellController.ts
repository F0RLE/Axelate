type WindowUiShellElements = {
    splash: HTMLElement | null;
    globalWarning: HTMLDialogElement | null;
    soundToggle: HTMLElement | null;
};

type WindowUiShellDeps = {
    getElements: () => WindowUiShellElements;
};

type WindowUiWarningMetrics = {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
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

    public updateWidthWarning(metrics: WindowUiWarningMetrics): void {
        const { splash, globalWarning } = this._deps.getElements();
        if (globalWarning === null) {
            return;
        }

        const showWarning = metrics.width < metrics.minWidth || metrics.height < metrics.minHeight;
        const isDuringSplash = splash !== null && !splash.classList.contains('hidden');

        if (showWarning && !isDuringSplash) {
            this._showGlobalWarning(globalWarning);
            return;
        }

        this._hideGlobalWarning(globalWarning);
    }

    public hideSplashScreen(schedule: (callback: () => void, delayMs: number) => void): void {
        const splash = this._deps.getElements().splash;
        if (splash !== null) {
            splash.classList.add('fade-out');
            schedule(() => {
                const currentSplash = this._deps.getElements().splash;
                if (currentSplash !== null) {
                    currentSplash.classList.remove('fade-out');
                    currentSplash.classList.add('hidden');
                }
                document.body.classList.remove('no-overflow');
            }, SPLASH_FADE_OUT_DELAY_MS);
        }

        this._showLayoutSections(['sidebar', 'app-header', 'main-area']);
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

    private _showGlobalWarning(globalWarning: HTMLDialogElement): void {
        if (globalWarning.open) {
            return;
        }

        globalWarning.showModal();
        document.body.classList.add('ui-hidden');
    }

    private _hideGlobalWarning(globalWarning: HTMLDialogElement): void {
        if (globalWarning.open !== true) {
            return;
        }

        globalWarning.close();
        document.body.classList.remove('ui-hidden');
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
