import { getGlobalWin } from '@/shared/utils/globalAccessor';
import { type WindowService } from '../services/WindowService';

export interface IWindowViewportState {
    isSmallScreen: boolean;
    wasMaximizedOnSmallScreen: boolean;
    maximizeIcon: HTMLElement | null;
}

export class WindowViewportController {
    constructor(private readonly _service: WindowService) {}

    public async applyInitialProtection(state: IWindowViewportState): Promise<void> {
        const policy = await this._service.checkPolicy();
        state.isSmallScreen = policy.isSmallScreen;

        if (!state.isSmallScreen) {
            return;
        }

        const isMaximized = await this._service.isMaximized();
        if (isMaximized) {
            state.wasMaximizedOnSmallScreen = false;
            return;
        }

        this._service.toggleMaximize().catch(() => {
            /* ignore */
        });
        state.wasMaximizedOnSmallScreen = true;
    }

    public async syncAfterResize(
        state: IWindowViewportState,
        shouldApply: () => boolean,
        updateMaximizeIcon: (isMaximized: boolean) => void,
        applyPolicyState: (isMaximized: boolean, isSmallScreen: boolean) => Promise<void> | void,
    ): Promise<void> {
        const [isMaximized, policy] = await Promise.all([
            this._service.isMaximized(),
            this._service.checkPolicy(),
        ]);

        if (!shouldApply()) {
            return;
        }

        updateMaximizeIcon(isMaximized);
        state.isSmallScreen = policy.isSmallScreen;
        await applyPolicyState(isMaximized, policy.isSmallScreen);
    }

    public async handleSmallScreenUnmaximize(
        state: IWindowViewportState,
        isMaximized: boolean,
    ): Promise<void> {
        if (!state.isSmallScreen) {
            return;
        }

        if (state.wasMaximizedOnSmallScreen && !isMaximized) {
            const win = getGlobalWin();
            const width = Math.floor((win.screen.availWidth || win.screen.width) * 0.85);
            const height = Math.floor((win.screen.availHeight || win.screen.height) * 0.85);

            await this._service.setSize(width, height);
            state.wasMaximizedOnSmallScreen = false;
        }
    }

    public updateMaximizeIcon(maximizeIcon: HTMLElement | null, isMaximized: boolean): void {
        this._updateMaximizeButtonLabels(isMaximized);
        this._updateMaximizeButtonIcon(maximizeIcon, isMaximized);
        document.body.classList.toggle('maximized', isMaximized);
    }

    private _updateMaximizeButtonLabels(isMaximized: boolean): void {
        const btn = document.getElementById('maximize-btn');
        if (!(btn instanceof HTMLElement)) {
            return;
        }

        const g = getGlobalWin();
        const labelKey = isMaximized ? 'ui.launcher.button.restore' : 'ui.launcher.button.maximize';
        const fallback = isMaximized ? 'Restore' : 'Maximize';
        const label = typeof g.t === 'function' ? g.t(labelKey, fallback) : fallback;

        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
        btn.dataset['i18nAriaLabel'] = labelKey;
        btn.dataset['i18nTitle'] = labelKey;
    }

    private _updateMaximizeButtonIcon(
        maximizeIcon: HTMLElement | null,
        isMaximized: boolean,
    ): void {
        if (maximizeIcon === null) {
            return;
        }

        const use = maximizeIcon.querySelector('use');
        if (use !== null) {
            use.setAttribute('href', isMaximized ? '#icon-restore' : '#icon-maximize');
            return;
        }

        maximizeIcon.textContent = '';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'icon');
        const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        useEl.setAttribute('href', isMaximized ? '#icon-restore' : '#icon-maximize');
        svg.appendChild(useEl);
        maximizeIcon.appendChild(svg);
    }
}
