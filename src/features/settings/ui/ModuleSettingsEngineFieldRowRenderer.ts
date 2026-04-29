import type { EngineConfig } from '@/features/ai/services/EngineConfigService';

type EngineFieldType = 'number' | 'text' | 'select' | 'password' | 'textarea';
type EngineInputElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

type EngineFieldRowOptions = {
    label: string;
    key: string;
    type: EngineFieldType;
    isEngineConfig: boolean;
    placeholder?: string;
    defaultValue?: number | string;
    options?: string[];
    optionLabels?: Record<string, string>;
    min?: number;
    max?: number;
    isFile?: boolean;
    isImage?: boolean;
    fileKind?: 'model';
    description?: string;
    fullWidth?: boolean;
    showInfoButton?: boolean;
    appId: string;
    config: EngineConfig | null;
};

type EngineFieldControl = {
    input: HTMLElement;
    engineInput: EngineInputElement;
    customSelect: { syncDisplay: () => void; destroy: () => void } | null;
    extraArgsControl: {
        root: HTMLElement;
        syncTokens: () => void;
    } | null;
};

type EngineFieldRowRendererDeps = {
    createControl: (options: EngineFieldRowOptions) => EngineFieldControl;
    setupInitialValue: (input: EngineInputElement, options: EngineFieldRowOptions) => void;
    setupEvents: (input: EngineInputElement, options: EngineFieldRowOptions) => void;
    registerCleanup: (cleanup: () => void) => void;
    getModelFileName: (path: string) => string;
    isTauri: () => boolean;
    addFileBrowseButton: (
        container: HTMLElement,
        input: HTMLInputElement,
        isImage: boolean,
        fileKind: 'model',
    ) => void;
    getExtraArgsInfoText: () => string;
    toggleInfoPopover: (
        anchor: HTMLButtonElement,
        appId: string,
        config: EngineConfig | null,
    ) => void;
};

export class ModuleSettingsEngineFieldRowRenderer {
    public constructor(private readonly _deps: EngineFieldRowRendererDeps) {}

    public render(container: HTMLElement, options: EngineFieldRowOptions): void {
        const row = document.createElement('div');
        const keyClass = options.key.replaceAll('_', '-');
        row.className = `local-engine-field-row local-engine-field-row--${keyClass}${options.fullWidth === true ? ' full-width' : ''}`;

        const labelRow = document.createElement('div');
        labelRow.className = 'local-engine-label-row';

        const label = document.createElement('label');
        label.textContent = options.label;
        label.className = 'local-engine-field-label';
        labelRow.appendChild(label);

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'local-engine-input-row';

        const { input, engineInput, customSelect, extraArgsControl } =
            this._deps.createControl(options);

        this._deps.setupInitialValue(engineInput, options);
        this._deps.setupEvents(engineInput, options);

        customSelect?.syncDisplay();
        if (customSelect !== null) {
            this._deps.registerCleanup(() => {
                customSelect.destroy();
            });
        }
        extraArgsControl?.syncTokens();

        if (options.isFile === true && engineInput instanceof HTMLInputElement) {
            engineInput.readOnly = true;
            engineInput.classList.add('local-engine-input--readonly');
            engineInput.dataset['fullPath'] = engineInput.value;
            if (engineInput.value.trim() !== '') {
                engineInput.value = this._deps.getModelFileName(engineInput.value);
            }
        }

        inputWrapper.appendChild(input);

        if (options.isFile === true && this._deps.isTauri()) {
            this._deps.addFileBrowseButton(
                inputWrapper,
                engineInput as HTMLInputElement,
                options.isImage === true,
                options.fileKind ?? 'model',
            );
        }

        if (options.showInfoButton === true) {
            this._appendInfoButton(inputWrapper, options, extraArgsControl);
        }

        row.appendChild(labelRow);
        if (options.description !== undefined && options.description !== '') {
            const hint = document.createElement('p');
            hint.className = 'local-engine-field-hint';
            hint.textContent = options.description;
            row.appendChild(hint);
        }
        row.appendChild(inputWrapper);
        container.appendChild(row);
    }

    private _appendInfoButton(
        inputWrapper: HTMLElement,
        options: EngineFieldRowOptions,
        extraArgsControl: { root: HTMLElement } | null,
    ): void {
        const infoButton = document.createElement('button');
        infoButton.type = 'button';
        infoButton.className = 'local-engine-info-btn';
        const infoText = this._deps.getExtraArgsInfoText();
        infoButton.setAttribute('aria-label', infoText);
        infoButton.title = infoText;
        infoButton.textContent = '+';
        infoButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._deps.toggleInfoPopover(infoButton, options.appId, options.config);
        });
        inputWrapper.appendChild(infoButton);

        if (options.isEngineConfig && options.key === 'extra_args' && extraArgsControl !== null) {
            extraArgsControl.root.style.cursor = 'pointer';
            extraArgsControl.root.addEventListener('click', (event) => {
                const target = event.target as Node;
                if (target === extraArgsControl.root) {
                    event.preventDefault();
                    event.stopPropagation();
                    this._deps.toggleInfoPopover(infoButton, options.appId, options.config);
                }
            });
        }
    }
}
