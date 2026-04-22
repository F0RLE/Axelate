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
    private static readonly _FILTER_TRANSITION_MS = 90;
    private static readonly _FILTER_RESET_MS = 150;

    private _populateTimer: ReturnType<typeof setTimeout> | null = null;
    private _styleResetTimer: ReturnType<typeof setTimeout> | null = null;
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
            listElement.style.willChange = 'opacity, transform';
            listElement.style.transition = `opacity ${ModalFilterTransitionController._FILTER_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${ModalFilterTransitionController._FILTER_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
            listElement.style.opacity = '0.86';
            listElement.style.transform = 'translateY(3px) scale(0.997)';

            this._populateTimer = setTimeout(() => {
                this._populateTimer = null;
                if (!this._canApplyTransitionStep(transitionVersion, listElement, category)) {
                    return;
                }

                this._options.populateAppList(listElement, selectedAppId);
                requestAnimationFrame(() => {
                    if (!this._canApplyTransitionStep(transitionVersion, listElement, category)) {
                        return;
                    }

                    listElement.style.opacity = '1';
                    listElement.style.transform = 'translateY(0) scale(1)';
                });

                this._styleResetTimer = setTimeout(() => {
                    this._styleResetTimer = null;
                    if (!this._canApplyTransitionStep(transitionVersion, listElement, category)) {
                        return;
                    }

                    listElement.style.willChange = 'auto';
                }, ModalFilterTransitionController._FILTER_RESET_MS);
            }, ModalFilterTransitionController._FILTER_TRANSITION_MS);
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

        if (this._populateTimer !== null) {
            clearTimeout(this._populateTimer);
            this._populateTimer = null;
        }

        if (this._styleResetTimer !== null) {
            clearTimeout(this._styleResetTimer);
            this._styleResetTimer = null;
        }

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
