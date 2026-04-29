import type {
    IApp,
    ReleaseComputeTarget,
    ReleaseDownloadOptions,
    ReleaseDownloadSelection,
    ReleaseDownloadVariant,
    ReleaseDownloadVersion,
} from '@/shared/types/coreTypes';

type TranslateFn = (key: string, fallback: string) => string;

type DownloadSelectionDialogOptions = {
    app: IApp;
    loadOptions: () => Promise<ReleaseDownloadOptions | null>;
    translate: TranslateFn;
};

const TARGETS: Array<Exclude<ReleaseComputeTarget, 'auto'>> = ['gpu', 'cpu'];

export function openDownloadSelectionDialog({
    app,
    loadOptions,
    translate,
}: DownloadSelectionDialogOptions): Promise<ReleaseDownloadSelection | null> {
    return new Promise((resolve) => {
        const host = document.body;
        const selectionView = document.createElement('div');
        selectionView.className = 'download-selection-view';
        selectionView.setAttribute('role', 'dialog');
        selectionView.setAttribute('aria-modal', 'false');
        selectionView.setAttribute(
            'aria-label',
            translate('ui.download.select_package', 'Select package'),
        );
        selectionView.tabIndex = -1;

        let options: ReleaseDownloadOptions | null = null;
        let selectedVersion: ReleaseDownloadVersion | null = null;
        let selectedTarget: Exclude<ReleaseComputeTarget, 'auto'> = 'gpu';
        let loading = true;
        let errorMessage: string | null = null;
        let resolved = false;

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close(null);
            }
        };

        const close = (value: ReleaseDownloadSelection | null): void => {
            if (resolved) return;
            resolved = true;
            document.removeEventListener('keydown', onKeyDown);
            document.body.classList.remove('download-selection-open');
            selectionView.remove();
            resolve(value);
        };

        const renderVariantSummary = (): string => {
            if (selectedVersion === null) return '';
            const variant = getVariant(selectedVersion, selectedTarget);
            if (variant === null) return '';
            const assetList = variant.assets
                .map((asset) => `<li>${escapeHtml(asset)}</li>`)
                .join('');
            return `
                <div class="download-selection-summary">
                    <div class="download-selection-summary-meta">
                        <span>${escapeHtml(formatBytes(variant.total_size))}</span>
                        <span>${escapeHtml(formatDate(selectedVersion.published_at, translate))}</span>
                    </div>
                    <ul>${assetList}</ul>
                </div>
            `;
        };

        const renderBody = (): string => {
            if (loading) {
                return `
                    <div class="download-selection-loading">
                        <div class="download-selection-spinner" aria-hidden="true"></div>
                        <span>${escapeHtml(translate('ui.download.loading_versions', 'Loading versions...'))}</span>
                    </div>
                `;
            }

            if (errorMessage !== null || options === null || selectedVersion === null) {
                return `
                    <div class="download-selection-loading download-selection-loading--error">
                        <span>${escapeHtml(errorMessage ?? translate('ui.download.no_release_options', 'No compatible release packages found'))}</span>
                    </div>
                `;
            }

            const activeVersion = selectedVersion;
            return `
                <div class="download-selection-targets" role="group" aria-label="${escapeHtml(
                    translate('ui.download.compute_target', 'Compute target'),
                )}">
                    ${TARGETS.map((target) => renderTargetButton(target, selectedTarget, activeVersion, translate)).join('')}
                </div>
                <div class="download-selection-version">
                    <div class="download-selection-version-header">
                        <span>${escapeHtml(translate('ui.download.version', 'Version'))}</span>
                        <small>${escapeHtml(formatDate(activeVersion.published_at, translate))}</small>
                    </div>
                    <div class="download-selection-version-list">
                        ${options.versions
                            .map((version, index) =>
                                renderVersionButton(version, activeVersion, index, translate),
                            )
                            .join('')}
                    </div>
                </div>
                ${renderVariantSummary()}
            `;
        };

        const render = (): void => {
            selectionView.innerHTML = `
                <form method="dialog" class="download-selection-panel">
                    <div class="download-selection-header">
                        <div class="download-selection-icon">${escapeHtml(app.icon ?? '')}</div>
                        <div>
                            <h3>${escapeHtml(app.name ?? app.id)}</h3>
                            <p>${escapeHtml(translate('ui.download.package_subtitle', 'Choose package and version'))}</p>
                        </div>
                    </div>
                    ${renderBody()}
                    <div class="download-selection-actions">
                        <button type="button" class="download-selection-cancel">${escapeHtml(
                            translate('ui.common.cancel', 'Cancel'),
                        )}</button>
                        <button type="submit" class="download-selection-confirm" ${
                            selectedVersion === null || loading ? 'disabled' : ''
                        }>${escapeHtml(
                            translate('ui.launcher.module.download', 'Download'),
                        )}</button>
                    </div>
                </form>
            `;

            bindEvents();
            keepSelectedVersionVisible();
        };

        const bindEvents = (): void => {
            selectionView.onclick = (event) => {
                if (event.target === selectionView) {
                    close(null);
                }
            };

            selectionView
                .querySelector<HTMLButtonElement>('.download-selection-cancel')
                ?.addEventListener('click', () => close(null));

            selectionView
                .querySelectorAll<HTMLButtonElement>('[data-download-version]')
                .forEach((button) => {
                    button.addEventListener('click', () => {
                        const tag = button.dataset['downloadVersion'];
                        if (tag === undefined || options === null) return;
                        selectedVersion =
                            options.versions.find((version) => version.tag_name === tag) ??
                            selectedVersion;
                        if (selectedVersion === null) return;
                        selectedTarget = normalizeTarget(selectedTarget, selectedVersion);
                        render();
                    });
                });

            selectionView
                .querySelectorAll<HTMLButtonElement>('[data-download-target]')
                .forEach((button) => {
                    button.addEventListener('click', () => {
                        const target = button.dataset['downloadTarget'];
                        if (selectedVersion === null) return;
                        if (target !== 'gpu' && target !== 'cpu') return;
                        if (getVariant(selectedVersion, target) === null) return;
                        selectedTarget = target;
                        render();
                    });
                });

            selectionView.querySelector('form')?.addEventListener('submit', (event) => {
                event.preventDefault();
                if (selectedVersion === null || loading) return;
                close({
                    tag_name: selectedVersion.tag_name,
                    compute_target: selectedTarget,
                });
            });
        };

        render();
        host.appendChild(selectionView);
        document.body.classList.add('download-selection-open');
        document.addEventListener('keydown', onKeyDown);
        selectionView.focus({ preventScroll: true });

        void loadOptions()
            .then((loadedOptions) => {
                if (resolved) return;
                options = loadedOptions;
                const firstVersion = options?.versions[0];
                if (options === null || firstVersion === undefined) {
                    errorMessage = translate(
                        'ui.download.no_release_options',
                        'No compatible release packages found',
                    );
                    return;
                }
                selectedVersion = firstVersion;
                selectedTarget = normalizeTarget(selectedVersion.recommended, selectedVersion);
            })
            .catch((err: unknown) => {
                errorMessage =
                    err instanceof Error && err.message.trim() !== ''
                        ? err.message
                        : translate(
                              'ui.download.load_versions_error',
                              'Failed to load release versions',
                          );
            })
            .finally(() => {
                if (resolved) return;
                loading = false;
                render();
            });
    });
}

function keepSelectedVersionVisible(): void {
    requestAnimationFrame(() => {
        document
            .querySelector<HTMLElement>('.download-selection-version-item.selected')
            ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
}

function renderTargetButton(
    target: Exclude<ReleaseComputeTarget, 'auto'>,
    selectedTarget: ReleaseComputeTarget,
    selectedVersion: ReleaseDownloadVersion,
    translate: TranslateFn,
): string {
    const variant = getVariant(selectedVersion, target);
    const selected = selectedTarget === target;
    const disabled = variant === null;
    const label =
        target === 'gpu'
            ? translate('ui.download.gpu_package', 'GPU')
            : translate('ui.download.cpu_package', 'CPU');
    const meta =
        variant === null
            ? translate('ui.download.unavailable', 'Unavailable')
            : formatBytes(variant.total_size);

    return `
        <button
            type="button"
            class="download-selection-target ${selected ? 'selected' : ''}"
            data-download-target="${target}"
            ${disabled ? 'disabled' : ''}
        >
            <span>${escapeHtml(label)}</span>
            <small>${escapeHtml(meta)}</small>
        </button>
    `;
}

function renderVersionButton(
    version: ReleaseDownloadVersion,
    selectedVersion: ReleaseDownloadVersion,
    index: number,
    translate: TranslateFn,
): string {
    const latest = index === 0 ? ` ${translate('ui.download.latest_suffix', '(latest)')}` : '';
    const date = formatDate(version.published_at, translate);
    const selected = version.tag_name === selectedVersion.tag_name;
    return `
        <button
            type="button"
            class="download-selection-version-item ${selected ? 'selected' : ''}"
            data-download-version="${escapeHtml(version.tag_name)}"
            aria-pressed="${selected ? 'true' : 'false'}"
        >
            <span>${escapeHtml(`${version.tag_name}${latest}`)}</span>
            <small>${escapeHtml(date)}</small>
        </button>
    `;
}

function normalizeTarget(
    target: ReleaseComputeTarget,
    version: ReleaseDownloadVersion,
): Exclude<ReleaseComputeTarget, 'auto'> {
    if (
        (target === 'gpu' || target === 'auto') &&
        version.gpu !== null &&
        version.gpu !== undefined
    ) {
        return 'gpu';
    }
    if (target === 'cpu' && version.cpu !== null && version.cpu !== undefined) {
        return 'cpu';
    }
    return version.cpu !== null && version.cpu !== undefined ? 'cpu' : 'gpu';
}

function getVariant(
    version: ReleaseDownloadVersion,
    target: ReleaseComputeTarget,
): ReleaseDownloadVariant | null {
    if (target === 'cpu') return version.cpu ?? null;
    if (target === 'gpu') return version.gpu ?? null;
    return version.gpu ?? version.cpu ?? null;
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(value: string | null | undefined, translate: TranslateFn): string {
    if (value === null || value === undefined || value === '') {
        return translate('ui.download.date_unknown', 'date unknown');
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
    }).format(date);
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
