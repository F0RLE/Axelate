type EngineFieldType = 'number' | 'text' | 'select' | 'password' | 'textarea';
type EngineInputElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type EngineFieldValue = string | number | string[] | null | undefined;
type ExtraArgsTranslate = (key: string, fallback: string) => string;
type PerformanceTranslate = (key: string, fallback: string) => string;

type EngineFieldInitialOptions = {
    key: string;
    isEngineConfig: boolean;
    defaultValue?: number | string;
    config: Record<string, EngineFieldValue> | null;
    settings: Record<string, string | number | undefined>;
};

type EngineFieldParseOptions = {
    type: EngineFieldType;
    min?: number;
    max?: number;
    defaultValue?: number | string;
};

export type ModuleSettingsEngineControlOptions = {
    type: EngineFieldType;
    placeholder?: string;
    min?: number;
    max?: number;
};

export type ModuleSettingsEngineInputFactoryDeps = {
    requestAnimationFrame: (callback: FrameRequestCallback) => number;
};

export type EngineFieldParsedValue = {
    value: string | number | null;
    displayValue: string;
};

export type EngineExtraArgsControl = {
    input: HTMLInputElement;
    root: HTMLDivElement;
    syncTokens: () => void;
    getGroups: () => string[];
    setGroups: (groups: string[]) => void;
};

export type EngineExtraArgDoc = {
    flag: string;
    description: string;
};

export type EngineExtraArgDocs = {
    title: string;
    subtitle: string;
    items: EngineExtraArgDoc[];
};

export class ModuleSettingsEngineInputFactory {
    public constructor(private readonly _deps: ModuleSettingsEngineInputFactoryDeps) {}

    public createTextAreaField(
        options: Pick<ModuleSettingsEngineControlOptions, 'placeholder'>,
    ): HTMLTextAreaElement {
        const textArea = document.createElement('textarea');
        textArea.className = 'settings-input local-engine-input local-engine-input--textarea';
        if (options.placeholder !== undefined && options.placeholder !== '') {
            textArea.placeholder = options.placeholder;
        }

        const autoResize = () => {
            textArea.style.height = 'auto';
            const extra = textArea.offsetHeight - textArea.clientHeight;
            textArea.style.height = `${textArea.scrollHeight + extra}px`;
        };

        textArea.addEventListener('input', autoResize);

        const valueDesc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (valueDesc?.set !== undefined) {
            const requestAnimationFrame = this._deps.requestAnimationFrame;
            Object.defineProperty(textArea, 'value', {
                set(v: string) {
                    valueDesc.set?.call(textArea, v);
                    requestAnimationFrame(autoResize);
                },
                get(): string {
                    const currentValue = valueDesc.get?.call(textArea) as unknown;
                    return typeof currentValue === 'string' ? currentValue : '';
                },
            });
        }

        this._deps.requestAnimationFrame(autoResize);
        return textArea;
    }

    public createTextInputField(
        options: Pick<ModuleSettingsEngineControlOptions, 'type' | 'placeholder' | 'min' | 'max'>,
    ): HTMLInputElement {
        const textInput = document.createElement('input');
        textInput.type = options.type;
        textInput.className = 'settings-input local-engine-input';
        if (options.type === 'number') {
            textInput.inputMode = 'numeric';
        }
        if (options.placeholder !== undefined && options.placeholder !== '') {
            textInput.placeholder = options.placeholder;
        }
        if (options.min !== undefined) {
            textInput.min = String(options.min);
        }
        if (options.max !== undefined) {
            textInput.max = String(options.max);
        }
        return textInput;
    }

    public createBasicControl(options: ModuleSettingsEngineControlOptions): EngineInputElement {
        if (options.type === 'textarea') {
            return this.createTextAreaField(options);
        }

        return this.createTextInputField(options);
    }
}

export function syncEnginePromptTextareaHeights(
    container: HTMLElement,
    requestAnimationFrameFn: (callback: FrameRequestCallback) => number,
    registerCleanup: (cleanup: () => void) => void,
): void {
    const textareas = Array.from(
        container.querySelectorAll<HTMLTextAreaElement>('.local-engine-input--textarea'),
    );
    if (textareas.length < 2) {
        return;
    }

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

export function createEngineExtraArgsField(translate: ExtraArgsTranslate): EngineExtraArgsControl {
    const root = document.createElement('div');
    root.className = 'local-engine-tags-editor';

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.className = 'local-engine-tags-value';

    const chips = document.createElement('div');
    chips.className = 'local-engine-tags-chips';

    const parseGroups = (raw: string): string[] => {
        const tokens = raw
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token !== '');
        const groups: string[] = [];

        for (let index = 0; index < tokens.length; index += 1) {
            const current = tokens[index];
            const next = tokens[index + 1];

            if (
                current !== undefined &&
                current.startsWith('-') &&
                next !== undefined &&
                !next.startsWith('-')
            ) {
                groups.push(`${current} ${next}`);
                index += 1;
                continue;
            }

            if (current !== undefined) {
                groups.push(current);
            }
        }

        return groups;
    };

    const flattenGroups = (groups: string[]): string =>
        groups
            .flatMap((group) =>
                group
                    .split(/\s+/)
                    .map((token) => token.trim())
                    .filter((token) => token !== ''),
            )
            .join(' ');

    const getGroups = (): string[] => parseGroups(hiddenInput.value);

    const syncTokens = () => {
        const groups = getGroups();
        chips.replaceChildren(
            ...groups.map((group, index) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'local-engine-tag-chip';
            chip.title = translate('ui.settings.engine.extra_args.remove', 'Remove');
            chip.dataset['groupIndex'] = String(index);

            const label = document.createElement('span');
            label.className = 'local-engine-tag-chip-label';
            label.textContent = group;

            const remove = document.createElement('span');
            remove.className = 'local-engine-tag-chip-remove';
            remove.textContent = 'x';

            chip.append(label, remove);
                return chip;
            }),
        );
    };

    const setGroups = (groups: string[]) => {
        hiddenInput.value = flattenGroups(groups);
        syncTokens();
        hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    };

    root.append(chips, hiddenInput);
    chips.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const chip = target.closest<HTMLButtonElement>('.local-engine-tag-chip');
        if (!(chip instanceof HTMLButtonElement)) {
            return;
        }

        const groupIndex = Number(chip.dataset['groupIndex']);
        if (Number.isNaN(groupIndex)) {
            return;
        }

        const updated = getGroups().filter((_, index) => index !== groupIndex);
        setGroups(updated);
    });

    return { input: hiddenInput, root, syncTokens, getGroups, setGroups };
}

export function getEngineExtraArgDocs(appId: string): EngineExtraArgDocs {
    if (appId === 'sdcpp' || appId === 'stable-diffusion') {
        return {
            title: 'Manual sd.cpp flags',
            subtitle:
                'These go into Extra Arguments as startup flags. Use the dedicated VAE Path and LLM Path fields for Qwen Image companion files.',
            items: [
                { flag: '--fa', description: 'Enable flash attention globally.' },
                {
                    flag: '--vae C:\\Models\\qwen_image_vae.safetensors',
                    description: 'Required companion VAE for Qwen Image GGUF models.',
                },
                {
                    flag: '--llm C:\\Models\\Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf',
                    description: 'Required companion LLM for Qwen Image GGUF models.',
                },
                {
                    flag: '--vae-tiling',
                    description: 'Use tiled VAE decoding to reduce VRAM usage.',
                },
                {
                    flag: '--diffusion-fa',
                    description: 'Enable flash attention for the diffusion model only.',
                },
                { flag: '--mmap', description: 'Memory-map model weights from disk.' },
                {
                    flag: '--offload-to-cpu',
                    description: 'Keep more weights in RAM to reduce VRAM pressure.',
                },
                { flag: '--clip-on-cpu', description: 'Run CLIP on CPU for low-VRAM setups.' },
                { flag: '--vae-on-cpu', description: 'Run VAE on CPU for low-VRAM setups.' },
                {
                    flag: '--control-net-cpu',
                    description: 'Run ControlNet on CPU when ControlNet is used.',
                },
                {
                    flag: '--vae-tile-size 64x64',
                    description: 'Increase tile size when using VAE tiling.',
                },
                {
                    flag: '--vae-relative-tile-size 0.5x0.5',
                    description: 'Tile VAE relative to image size.',
                },
                { flag: '--rng cuda', description: 'Prefer CUDA RNG on NVIDIA systems.' },
                {
                    flag: '--sampler-rng cuda',
                    description: 'Use CUDA RNG specifically for the sampler.',
                },
            ],
        };
    }

    return {
        title: 'Manual llama.cpp flags',
        subtitle:
            'These are appended to llama-server startup. Context window and GPU layers are already managed by the launcher UI.',
        items: [
            { flag: '--flash-attn', description: 'Enable flash attention if supported.' },
            { flag: '--threads 8', description: 'Set explicit CPU thread count.' },
            { flag: '--parallel 1', description: 'Limit parallel slots for stability.' },
            { flag: '--mlock', description: 'Keep model memory pinned in RAM.' },
            { flag: '--no-mmap', description: 'Disable mmap if storage causes issues.' },
        ],
    };
}

export function setupInitialEngineFieldValue(
    input: EngineInputElement,
    options: EngineFieldInitialOptions,
): void {
    if (options.isEngineConfig) {
        setInitialEngineConfigValue(input, options.key, options.config);
        return;
    }

    setInitialEngineSettingsValue(input, options.key, options.defaultValue, options.settings);
}

export function parseEngineFieldValue(
    raw: string,
    options: EngineFieldParseOptions,
): EngineFieldParsedValue {
    if (options.type === 'number') {
        return parseNumberFieldValue(raw, options);
    }
    if (options.type === 'select') {
        return parseSelectFieldValue(raw, options.defaultValue);
    }
    return { value: raw === '' ? null : raw, displayValue: raw };
}

export function formatEngineFieldSaveValue(
    key: string,
    value: string | number | null,
): string | number | string[] | null {
    if (key === 'extra_args') {
        if (typeof value === 'string') {
            return value.trim() ? value.trim().split(/\s+/) : [];
        }
        return [];
    }

    return value;
}

function setInitialEngineConfigValue(
    input: EngineInputElement,
    key: string,
    config: Record<string, EngineFieldValue> | null,
): void {
    if (config === null) {
        return;
    }

    let value = config[key];
    if (value === undefined) {
        return;
    }

    if (key === 'extra_args' && Array.isArray(value)) {
        value = value.join(' ');
    }

    const stringValue = String(value);
    input.value = stringValue;
    input.title = stringValue;
}

function setInitialEngineSettingsValue(
    input: EngineInputElement,
    key: string,
    defaultValue: number | string | undefined,
    settings: Record<string, string | number | undefined>,
): void {
    const value = settings[key];
    if (value !== undefined) {
        input.value = String(value);
        return;
    }

    if (defaultValue !== undefined) {
        input.value = String(defaultValue);
    }
}

function parseNumberFieldValue(
    raw: string,
    options: Pick<EngineFieldParseOptions, 'min' | 'max' | 'defaultValue'>,
): EngineFieldParsedValue {
    if (raw === '') {
        return { value: null, displayValue: '' };
    }

    let numberValue = Number(raw);
    if (Number.isNaN(numberValue)) {
        const defaultValue = options.defaultValue as number | undefined;
        return {
            value: defaultValue ?? null,
            displayValue: defaultValue === undefined ? '' : String(defaultValue),
        };
    }

    if (options.min !== undefined && numberValue < options.min) {
        numberValue = options.min;
    }
    if (options.max !== undefined && numberValue > options.max) {
        numberValue = options.max;
    }

    return { value: numberValue, displayValue: String(numberValue) };
}

function parseSelectFieldValue(
    raw: string,
    defaultValue?: number | string,
): EngineFieldParsedValue {
    if (raw === '') {
        const stringDefaultValue = defaultValue as string | undefined;
        return {
            value: stringDefaultValue ?? null,
            displayValue: stringDefaultValue === undefined ? '' : String(stringDefaultValue),
        };
    }

    return { value: raw, displayValue: raw };
}
