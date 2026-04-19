import type { IApp } from '../../types/coreTypes';
import type { ModuleCardRenderer } from './ModuleCardRenderer';
import type { ModalSelectionPolicy } from './ModalSelectionPolicy';
import { renderModalEmptyState } from './ModalFilterUi';

type AppInteractionHandler = (event: MouseEvent, app: IApp, category: string) => void;
type DownloadHandler = (app: IApp) => void;
type TranslateFunc = (key: string, fallback: string) => string;

export function populateModalAppList(options: {
    listElement: HTMLElement;
    apps: IApp[];
    category: string;
    selectedAppId: string | null;
    currentFilter: 'text' | 'image';
    selectionPolicy: ModalSelectionPolicy;
    cardRenderer: ModuleCardRenderer;
    onAppInteraction: AppInteractionHandler;
    onDownload: DownloadHandler;
    translate: TranslateFunc;
}): void {
    const visibleApps = options.selectionPolicy.getVisibleApps(
        options.apps,
        options.category,
        options.currentFilter,
    );

    options.listElement.innerHTML = '';
    if (visibleApps.length === 0) {
        renderModalEmptyState(options.listElement, options.translate);
        return;
    }

    const isAiCategory = options.category === 'ai' || options.category.startsWith('ai_');
    const interactionCategory = isAiCategory ? `ai_${options.currentFilter}` : options.category;

    visibleApps.forEach((app) => {
        const isSelected = options.selectedAppId !== null && app.id === options.selectedAppId;
        const card = options.cardRenderer.createCard(
            app,
            interactionCategory,
            isSelected,
            (event, currentApp) => options.onAppInteraction(event, currentApp, interactionCategory),
            (currentApp) => options.onDownload(currentApp),
        );
        options.listElement.appendChild(card);
    });
}

export function transitionSelectionButton(options: {
    card: HTMLElement;
    isSelected: boolean;
    selectionPolicy: ModalSelectionPolicy;
    translate: TranslateFunc;
}): void {
    const button = options.card.querySelector<HTMLButtonElement>('.app-card-hover-actions button');
    if (button === null) {
        return;
    }

    const state = options.selectionPolicy.getButtonState(options.card, options.isSelected);
    button.className = state.className;
    button.dataset['i18n'] = state.key;
    button.textContent = options.translate(state.key, state.defaultLabel);
}
