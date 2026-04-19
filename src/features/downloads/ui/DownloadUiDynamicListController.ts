import type { IModuleDownloadState as ModuleDownloadState } from '@/shared/types/coreTypes';

import { DOWNLOAD_UI_SELECTORS, getDownloadDynamicList } from './DownloadUiDom';

type DownloadUiDynamicListControllerDeps = {
    syncCards: (list: HTMLElement, activeDownloads: Map<string, ModuleDownloadState>) => void;
};

export class DownloadUiDynamicListController {
    public constructor(private readonly _deps: DownloadUiDynamicListControllerDeps) {}

    public ensureList(): void {
        if (getDownloadDynamicList() !== null) return;

        const body = document.getElementById(DOWNLOAD_UI_SELECTORS.BODY);
        if (body === null) return;

        const list = document.createElement('div');
        list.id = DOWNLOAD_UI_SELECTORS.DYNAMIC_LIST;
        list.className = 'downloads-dynamic-list';
        body.prepend(list);
    }

    public render(activeDownloads: Map<string, ModuleDownloadState>): void {
        const list = getDownloadDynamicList();
        if (list === null) return;

        const emptyText = document.getElementById(DOWNLOAD_UI_SELECTORS.EMPTY_TEXT);
        const mainCard = document.getElementById(DOWNLOAD_UI_SELECTORS.MAIN_CARD);
        const infoCard = document.querySelector<HTMLElement>(DOWNLOAD_UI_SELECTORS.INFO_CARD);

        if (activeDownloads.size === 0) {
            list.innerHTML = '';
            if (emptyText !== null) emptyText.classList.add('hidden');
            if (mainCard !== null) mainCard.style.display = 'none';
            if (infoCard !== null) infoCard.classList.add('hidden');
            return;
        }

        if (emptyText !== null) emptyText.classList.add('hidden');
        if (mainCard !== null) mainCard.style.display = 'none';
        if (infoCard !== null) infoCard.classList.add('hidden');

        this._deps.syncCards(list, activeDownloads);
    }
}
