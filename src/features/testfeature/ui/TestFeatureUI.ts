import { BaseComponent } from '../../../shared/ui/BaseComponent';
import { logger } from '../../../shared/services/LoggerService';
import { renderSimpleFeature } from '../../../shared/ui/renderSimpleFeature';

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
    protected onInit(): void {
        logger.debug('[TestFeatureUI] Initializing');
    }

    /**
     * Render or update the DOM.
     */
    protected render(): void {
        const root = this.getElement('testfeature-root');
        if (!root) return;

        renderSimpleFeature(root, 'testfeature-container', 'testfeature.title', 'TestFeature');
    }

    /**
     * Cleanup specialized resources.
     * Event listeners are auto-managed by _abortController.
     */
    protected onDestroy(): void {
        logger.debug('[TestFeatureUI] Destroying');
    }
}
