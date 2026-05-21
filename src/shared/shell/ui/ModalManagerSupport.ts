import type { IApp } from '../../types/coreTypes';
import { ModuleCardRenderer } from './ModuleCardRenderer';
import type { ModuleCardDownloadAction } from './ModuleCardActions';
import type { ModalSelectionPolicy } from './ModalSelectionPolicy';
import { getAiSlotForCapability, isAiCategory } from '../../utils/moduleCategoryPolicy';

type DownloadProgressPayload = {
    module_id: string;
    status: string;
    progress: number;
};

type AppInteractionHandler = (event: MouseEvent, app: IApp, category: string) => void;
type DownloadHandler = (app: IApp, action: ModuleCardDownloadAction) => void;
type ProgressEventHandler = (event: Event) => void;
type TranslateFunc = (key: string, fallback: string) => string;

export async function cancelModalDownload(options: {
    app: IApp;
    card: HTMLElement | null | undefined;
    button: HTMLButtonElement;
    onCancelDownloadRequest: (app: IApp) => Promise<void>;
    translate: TranslateFunc;
}): Promise<void> {
    await options.onCancelDownloadRequest(options.app);

    if (options.card !== null && options.card !== undefined) {
        ModuleCardRenderer.clearDownloadProgress(options.card);
    }

    resetModalDownloadButton(options.button, options.translate);
}

export function createModalDownloadProgressHandler(): ProgressEventHandler {
    const throttleMap = new Map<string, number>();

    return (event: Event) => {
        const payload = (event as CustomEvent).detail as DownloadProgressPayload;
        if (!payload.module_id) {
            return;
        }

        const now = Date.now();
        const isTerminal =
            payload.status === 'complete' ||
            payload.status === 'error' ||
            payload.status === 'cancelled';

        const lastRender = throttleMap.get(payload.module_id) ?? 0;
        const isControlState = payload.status === 'paused';
        const withinThrottle =
            isTerminal === false && isControlState === false && now - lastRender < 150;
        if (withinThrottle) {
            return;
        }
        throttleMap.set(payload.module_id, now);

        const list = document.getElementById('app-modal-list');
        if (list === null) {
            return;
        }

        const card = list.querySelector<HTMLElement>(
            `.app-card[data-app-id="${payload.module_id}"]`,
        );
        if (card === null) {
            return;
        }

        if (isTerminal) {
            throttleMap.delete(payload.module_id);
            ModuleCardRenderer.clearDownloadProgress(card);
            if (payload.status === 'complete') {
                card.classList.add('is-installed');
            }
            return;
        }

        const progressPercent = payload.progress < 0 ? -1 : Math.round(payload.progress * 100);
        ModuleCardRenderer.setDownloadProgress(card, progressPercent, payload.status);
    };
}

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
    options.listElement.classList.toggle('app-grid-empty', visibleApps.length === 0);
    if (visibleApps.length === 0) {
        renderModalEmptyState(options.listElement, options.translate);
        return;
    }

    const interactionCategory = isAiCategory(options.category)
        ? getAiSlotForCapability(options.currentFilter)
        : options.category;

    visibleApps.forEach((app) => {
        const isSelected = options.selectedAppId !== null && app.id === options.selectedAppId;
        const card = options.cardRenderer.createSelectionCard(
            app,
            interactionCategory,
            isSelected,
            (event, currentApp) => options.onAppInteraction(event, currentApp, interactionCategory),
            (currentApp, action) => options.onDownload(currentApp, action),
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
    const button = options.card.querySelector<HTMLButtonElement>(
        '.module-selection-card-actions button',
    );
    if (button === null) {
        return;
    }

    const state = options.selectionPolicy.getButtonState(options.card, options.isSelected);
    button.className = state.className;
    button.dataset['i18n'] = state.key;
    button.textContent = options.translate(state.key, state.defaultLabel);
}

export function applyImageFilterAvailability(
    apps: IApp[],
    currentFilter: 'text' | 'image',
    translate: TranslateFunc,
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
    imageButton.title = hasImageApps ? '' : translate('ui.launcher.web.coming_soon', 'Coming soon');

    textButton?.classList.toggle('active', nextFilter === 'text');
    imageButton.classList.toggle('active', nextFilter === 'image');

    return nextFilter;
}

export function updateModalSidebarWidth(sidebar: HTMLElement): void {
    const spans = Array.from(sidebar.querySelectorAll<HTMLElement>('.category-filter-btn span'));
    let maxTextWidth = 0;

    spans.forEach((span) => {
        if (span.scrollWidth > maxTextWidth) {
            maxTextWidth = span.scrollWidth;
        }
    });

    if (maxTextWidth <= 0) {
        return;
    }

    const expandedButtonWidth = 44 + 12 + maxTextWidth + 16;
    const expandedSidebarWidth = Math.max(160, expandedButtonWidth + 24);

    sidebar.style.setProperty('--sidebar-expanded-width', `${expandedSidebarWidth.toString()}px`);
    sidebar.style.setProperty('--filter-btn-expanded-width', `${expandedButtonWidth.toString()}px`);
}

function renderModalEmptyState(listElement: HTMLElement, translate: TranslateFunc): void {
    const template = document.getElementById(
        'tpl-empty-state-module',
    ) as HTMLTemplateElement | null;
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

function resetModalDownloadButton(button: HTMLButtonElement, translate: TranslateFunc): void {
    const progress = button.querySelector<HTMLElement>('.download-pct');
    if (progress !== null) {
        progress.style.display = 'none';
    }

    const label = button.querySelector<HTMLElement>('.download-label');
    if (label !== null) {
        label.style.display = '';
        label.textContent = translate('ui.launcher.module.download', 'Download');
    }
}
