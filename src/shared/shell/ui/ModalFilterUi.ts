import type { IApp } from '../../types/coreTypes';
import type { ModalSelectionPolicy } from './ModalSelectionPolicy';

export function applyImageFilterAvailability(
    apps: IApp[],
    currentFilter: 'text' | 'image',
    translate: (key: string, defaultText: string) => string,
    selectionPolicy: ModalSelectionPolicy,
): 'text' | 'image' {
    const hasImageApps = selectionPolicy.hasImageApps(apps);
    const nextFilter = !hasImageApps && currentFilter === 'image' ? 'text' : currentFilter;

    const textButton = document.getElementById('filter-text-btn') as HTMLButtonElement | null;
    const imageButton = document.getElementById('filter-image-btn') as HTMLButtonElement | null;
    if (imageButton === null) {
        return nextFilter;
    }

    imageButton.disabled = !hasImageApps;
    imageButton.style.opacity = hasImageApps ? '' : '0.4';
    imageButton.style.cursor = hasImageApps ? '' : 'not-allowed';
    imageButton.title = hasImageApps
        ? ''
        : translate('ui.launcher.web.coming_soon', 'Coming soon');

    textButton?.classList.toggle('active', nextFilter === 'text');
    imageButton.classList.toggle('active', nextFilter === 'image');

    return nextFilter;
}

export function renderModalEmptyState(
    listElement: HTMLElement,
    translate: (key: string, defaultText: string) => string,
): void {
    const template = document.getElementById('tpl-empty-state-module') as HTMLTemplateElement | null;
    if (template === null) {
        return;
    }

    const clone = template.content.cloneNode(true) as DocumentFragment;
    const label = clone.querySelector('span');
    if (label !== null) {
        label.dataset['i18n'] = 'ui.launcher.modules.modal.no_apps_filter';
        label.textContent = translate(
            'ui.launcher.modules.modal.no_apps_filter',
            'No applications found for this type',
        );
    }

    listElement.appendChild(clone);
}
