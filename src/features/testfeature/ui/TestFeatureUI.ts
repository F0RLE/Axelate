import { BaseComponent } from '../../../shared/ui/BaseComponent';
import { logger } from '../../../shared/services/LoggerService';
import type { TGlobalWin } from '../../../shared/types/global_bridge_types';

/**
 * @class TestFeatureUI
 * @extends BaseComponent
 * @description UI controller for the TestFeature feature.
 */
export class TestFeatureUI extends BaseComponent {
    constructor() {
        super();
    }

    /**
     * Component initialization logic.
     * Use super.getElement() for cached lookups.
     */
    protected async onInit(): Promise<void> {
        logger.debug('[TestFeatureUI] Initializing');
    }

    /**
     * Render or update the DOM.
     */
    protected render(): void {
        const root = this.getElement('testfeature-root');
        if (!root) return;

        const win = globalThis as TGlobalWin;
        const title = typeof win.t === 'function' ? win.t('testfeature.title', 'TestFeature') : 'TestFeature';

        root.innerHTML = `<div class="testfeature-container">
                <h1>${title}</h1>
            </div>`;
    }

    /**
     * Cleanup specialized resources.
     * Event listeners are auto-managed by _abortController.
     */
    protected onDestroy(): void {
        logger.debug('[TestFeatureUI] Destroying');
    }
}
