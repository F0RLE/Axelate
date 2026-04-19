export function syncEnginePromptTextareaHeights(
    container: HTMLElement,
    requestAnimationFrameFn: (callback: FrameRequestCallback) => number,
    registerCleanup: (cleanup: () => void) => void,
): void {
    const textareas = Array.from(
        container.querySelectorAll<HTMLTextAreaElement>('.local-engine-input--textarea'),
    );
    if (textareas.length < 2) return;

    const sync = () => {
        let maxHeight = 0;
        textareas.forEach((textarea) => {
            textarea.style.height = 'auto';
            const extra = textarea.offsetHeight - textarea.clientHeight;
            const nextHeight = textarea.scrollHeight + extra;
            if (nextHeight > maxHeight) {
                maxHeight = nextHeight;
            }
        });
        textareas.forEach((textarea) => {
            textarea.style.height = `${maxHeight}px`;
        });
    };

    textareas.forEach((textarea) => {
        textarea.addEventListener('input', sync);
        registerCleanup(() => {
            textarea.removeEventListener('input', sync);
        });
    });

    requestAnimationFrameFn(sync);
}

type PerformanceTranslate = (key: string, fallback: string) => string;

export function renderEnginePerformanceModeField(
    container: HTMLElement,
    appId: string,
    settings: Record<string, string | boolean | undefined>,
    translate: PerformanceTranslate,
    debouncedSave: (key: string, value: string | number | boolean | null) => void,
): void {
    const row = document.createElement('div');
    row.className = 'local-engine-field-row';

    const labelRow = document.createElement('div');
    labelRow.className = 'local-engine-label-row';

    const label = document.createElement('label');
    label.textContent = translate('ui.settings.engine.performance_mode', 'Performance Mode');
    label.className = 'local-engine-field-label';
    labelRow.appendChild(label);

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'local-engine-performance-toggle';

    const statusLabel = document.createElement('span');
    statusLabel.className = 'local-engine-performance-toggle-status local-engine-perf-status';

    const switchLabel = document.createElement('label');
    switchLabel.className = 'switch';
    switchLabel.style.pointerEvents = 'none';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';

    const slider = document.createElement('span');
    slider.className = 'slider';

    switchLabel.append(checkbox, slider);
    inputWrapper.append(statusLabel, switchLabel);

    let enabled = String(settings[`${appId}_performance_mode`] ?? 'false').toLowerCase() === 'true';

    const sync = () => {
        statusLabel.textContent = enabled
            ? translate('ui.common.enabled', 'Enabled')
            : translate('ui.common.disabled', 'Disabled');
        inputWrapper.classList.toggle('is-enabled', enabled);
        checkbox.checked = enabled;
    };
    sync();

    inputWrapper.addEventListener('click', () => {
        enabled = !enabled;
        sync();
        debouncedSave(`${appId}_performance_mode`, enabled);
    });

    row.append(labelRow, inputWrapper);
    container.appendChild(row);
}
