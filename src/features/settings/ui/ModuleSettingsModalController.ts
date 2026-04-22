import type { NavigationService } from '@/infrastructure/navigation/NavigationService';

type ModuleSettingsModalControllerDeps = {
    closeAppSelection: () => void;
};

export class ModuleSettingsModalController {
    constructor(
        private readonly _navigation: NavigationService,
        private readonly _deps: ModuleSettingsModalControllerDeps,
    ) {}

    public close(): void {
        this._navigation.removeBackAction('module-settings-modal');
        const modal = document.getElementById('module-settings-modal') as HTMLDialogElement | null;
        if (modal !== null) {
            if (modal.open) {
                modal.close();
            }
            modal.classList.add('hidden');
        }

        this._setBackgroundHidden(false);
    }

    public open(
        appId: string,
        onClose: () => void,
        onReopen: () => void,
    ): HTMLDialogElement | null {
        const modal = document.getElementById('module-settings-modal') as HTMLDialogElement | null;
        if (modal === null) {
            return null;
        }

        modal.classList.remove('hidden');
        this._navigation.pushBackAction('module-settings-modal', onClose, onReopen);
        if (typeof modal.show === 'function') {
            modal.show();
        } else if (typeof modal.showModal === 'function') {
            modal.showModal();
        } else {
            modal.setAttribute('open', '');
        }

        this._deps.closeAppSelection();

        this._setBackgroundHidden(true);

        const closeBtn = document.getElementById('close-module-settings-btn');
        if (closeBtn instanceof HTMLElement) {
            closeBtn.onclick = () => {
                onClose();
            };
        }

        modal.onclick = (event) => {
            if (
                event.target === modal ||
                (event.target as HTMLElement).classList.contains('modal-backdrop')
            ) {
                onClose();
            }
        };

        modal.dataset['moduleSettingsAppId'] = appId;
        return modal;
    }

    private _setBackgroundHidden(hidden: boolean): void {
        document.body.classList.toggle('settings-modal-open', hidden);

        const sidebar = document.getElementById('sidebar');
        const header = document.getElementById('app-header');
        const modelsContainer = document.querySelector('.models-container');
        const pages = document.querySelectorAll('.page');

        sidebar?.classList.toggle('content-hidden', hidden);
        header?.classList.toggle('content-hidden', hidden);
        modelsContainer?.classList.toggle('content-hidden', hidden);
        pages.forEach((page) => page.classList.toggle('content-hidden', hidden));
    }
}
