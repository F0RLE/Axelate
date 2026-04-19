export const DOWNLOAD_UI_SELECTORS = {
    PROGRESS_BAR: 'downloads-progress-bar',
    PROGRESS_TEXT: 'downloads-progress-text',
    SPEED: 'downloads-speed',
    DOWNLOADED: 'downloads-downloaded',
    TOTAL: 'downloads-total',
    ITEM_LABEL: 'downloads-item-label',
    STATUS: 'downloads-status',
    ETA: 'downloads-eta',
    MAIN_CARD: 'downloads-main-card',
    EMPTY_TEXT: 'downloads-empty-text',
    BODY: 'downloads-body',
    HEADER: '.downloads-header',
    CONTAINER: 'downloads-container',
    DYNAMIC_LIST: 'downloads-dynamic-list',
    INFO_CARD: '.downloads-info-card',
} as const;

export type DownloadUiElements = ReturnType<typeof getDownloadUiElements>;

export function getDownloadUiElements() {
    return {
        bar: document.getElementById(DOWNLOAD_UI_SELECTORS.PROGRESS_BAR),
        text: document.getElementById(DOWNLOAD_UI_SELECTORS.PROGRESS_TEXT),
        speedEl: document.getElementById(DOWNLOAD_UI_SELECTORS.SPEED),
        downloadedEl: document.getElementById(DOWNLOAD_UI_SELECTORS.DOWNLOADED),
        totalEl: document.getElementById(DOWNLOAD_UI_SELECTORS.TOTAL),
        labelEl: document.getElementById(DOWNLOAD_UI_SELECTORS.ITEM_LABEL),
        statusEl: document.getElementById(DOWNLOAD_UI_SELECTORS.STATUS),
        etaEl: document.getElementById(DOWNLOAD_UI_SELECTORS.ETA),
        mainCard: document.getElementById(DOWNLOAD_UI_SELECTORS.MAIN_CARD),
        emptyText: document.getElementById(DOWNLOAD_UI_SELECTORS.EMPTY_TEXT),
        infoCard: document.querySelector<HTMLElement>(DOWNLOAD_UI_SELECTORS.INFO_CARD),
        downloadsBody: document.getElementById(DOWNLOAD_UI_SELECTORS.BODY),
        downloadsHeader: document.querySelector<HTMLElement>(DOWNLOAD_UI_SELECTORS.HEADER),
        downloadsContainer: document.getElementById(DOWNLOAD_UI_SELECTORS.CONTAINER),
        pageDownloads: document.getElementById('page-downloads'),
    };
}

export function getDownloadDynamicList(): HTMLElement | null {
    return document.getElementById(DOWNLOAD_UI_SELECTORS.DYNAMIC_LIST);
}
