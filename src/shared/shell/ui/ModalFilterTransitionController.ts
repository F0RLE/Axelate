import type { IApp } from '../../types/coreTypes';
import type { ModalSelectionPolicy } from './ModalSelectionPolicy';
import { applyImageFilterAvailability } from './ModalManagerSupport';

type FilterType = 'text' | 'image';

type FilterTransitionControllerOptions = {
    getCurrentFilter: () => FilterType;
    setCurrentFilter: (filter: FilterType) => void;
    getCurrentCategory: () => string | null;
    getCurrentApps: () => IApp[];
    isModalOpen: () => boolean;
    onFilterChange: (filter: FilterType) => string | null;
    updateSelectedAppId: (appId: string | null) => void;
    populateAppList: (listElement: HTMLElement, selectedAppId: string | null) => void;
    translate: (key: string, fallback: string) => string;
    selectionPolicy: ModalSelectionPolicy;
};

export class ModalFilterTransitionController {
    private _transitionVersion = 0;

    public constructor(private readonly _options: FilterTransitionControllerOptions) {}

    public destroy(): void {
        this.cancelPending();
    }

    public syncAvailability(apps: IApp[]): FilterType {
        const nextFilter = applyImageFilterAvailability(
            apps,
            this._options.getCurrentFilter(),
            this._options.translate,
            this._options.selectionPolicy,
        );
        this._options.setCurrentFilter(nextFilter);
        return nextFilter;
    }

    public bind(category: string): void {
        const textButton = document.getElementById('filter-text-btn') as HTMLButtonElement | null;
        const imageButton = document.getElementById('filter-image-btn') as HTMLButtonElement | null;

        const updateTabUi = () => {
            const currentFilter = this._options.getCurrentFilter();
            textButton?.classList.toggle('active', currentFilter === 'text');
            imageButton?.classList.toggle('active', currentFilter === 'image');
        };

        const applyFilter = (filter: FilterType) => {
            if (this._options.getCurrentFilter() === filter) {
                return;
            }

            this._options.setCurrentFilter(filter);
            updateTabUi();

            const selectedAppId = this._options.onFilterChange(filter);
            this._options.updateSelectedAppId(selectedAppId);

            const listElement = document.getElementById('app-modal-list');
            if (!(listElement instanceof HTMLElement)) {
                return;
            }

            this.cancelPending();

            const transitionVersion = ++this._transitionVersion;
            if (!this._canApplyTransitionStep(transitionVersion, listElement, category)) {
                return;
            }

            this._options.populateAppList(listElement, selectedAppId);
        };

        if (textButton !== null) {
            textButton.onclick = () => applyFilter('text');
        }

        if (imageButton !== null) {
            imageButton.onclick = () => applyFilter('image');
        }

        updateTabUi();
    }

    public cancelPending(): void {
        this._transitionVersion += 1;

        const listElement = document.getElementById('app-modal-list');
        if (!(listElement instanceof HTMLElement)) {
            return;
        }

        listElement.style.removeProperty('will-change');
        listElement.style.removeProperty('transition');
        listElement.style.removeProperty('opacity');
        listElement.style.removeProperty('transform');
    }

    private _canApplyTransitionStep(
        transitionVersion: number,
        listElement: HTMLElement,
        category: string,
    ): boolean {
        return (
            transitionVersion === this._transitionVersion &&
            this._options.isModalOpen() &&
            this._options.getCurrentCategory() === category &&
            document.getElementById('app-modal-list') === listElement
        );
    }
}
