import type { EventBus } from '@/shared/services/EventBus';

type AppUiLifecycleBindingsDeps = {
    eventBus: EventBus;
    onLanguageChanged: () => void;
    onPageChange: (payload: { pageId: string }) => void;
};

export class AppUiLifecycleBindings {
    private readonly _boundLanguageChanged = () => {
        this._deps.onLanguageChanged();
    };

    private readonly _pageChangeUnsub: () => void;

    public constructor(private readonly _deps: AppUiLifecycleBindingsDeps) {
        globalThis.addEventListener('language-changed', this._boundLanguageChanged);
        this._pageChangeUnsub = this._deps.eventBus.on('page:change', (payload) => {
            this._deps.onPageChange(payload);
        });
    }

    public destroy(): void {
        globalThis.removeEventListener('language-changed', this._boundLanguageChanged);
        this._pageChangeUnsub();
    }
}
