type EngineFieldType = 'number' | 'text' | 'select' | 'password' | 'textarea';
type EngineInputElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type EngineFieldValue = string | number | string[] | null | undefined;
type ExtraArgsTranslate = (key: string, fallback: string) => string;
export type EngineModelFileKind = 'model';
export type EngineModelFileFilter = { name: string; extensions: string[] };

type EngineFieldInitialOptions = {
    key: string;
    isEngineConfig: boolean;
    defaultValue?: number | string;
    config: Record<string, EngineFieldValue> | null;
    settings: Record<string, string | number | null | undefined>;
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
    setGroups: (groups: string[], options?: { emit?: boolean }) => void;
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

type EngineExtraArgDocSource = {
    flag: string;
    fallback: string;
};

const SDCPP_EXTRA_ARG_DOCS: EngineExtraArgDocSource[] = [
    { flag: '--threads 8', fallback: 'Set worker thread count.' },
    { flag: '--vae path', fallback: 'Set VAE model path.' },
    { flag: '--taesd path', fallback: 'Set TAESD model path.' },
    { flag: '--control-net path', fallback: 'Set ControlNet model path.' },
    { flag: '--embd-dir path', fallback: 'Load textual inversion embeddings.' },
    { flag: '--stacked-id-embd-dir path', fallback: 'Load stacked ID embeddings.' },
    { flag: '--input-id-images-dir path', fallback: 'Load input ID images.' },
    { flag: '--lora-model-dir path', fallback: 'Directory containing LoRA models.' },
    { flag: '--vae-decode-only', fallback: 'Decode a latent image with VAE only.' },
    { flag: '--vae-encode-only', fallback: 'Encode an image into latent space.' },
    { flag: '--control-image path', fallback: 'Image used by ControlNet.' },
    { flag: '--output-video path', fallback: 'Set output video path.' },
    { flag: '--init-img path', fallback: 'Use an initial image for img2img.' },
    { flag: '--mask path', fallback: 'Use a mask image for inpainting.' },
    { flag: '--ref-image path', fallback: 'Use a reference image.' },
    { flag: '--clip_l path', fallback: 'Set CLIP-L model path.' },
    { flag: '--clip_g path', fallback: 'Set CLIP-G model path.' },
    { flag: '--clip_vision path', fallback: 'Set CLIP-Vision model path.' },
    { flag: '--t5xxl path', fallback: 'Set T5-XXL model path.' },
    { flag: '--llm path', fallback: 'Set LLM model path.' },
    { flag: '--diffusion-fa', fallback: 'Enable flash attention for diffusion.' },
    { flag: '--fa', fallback: 'Enable flash attention globally.' },
    { flag: '--no-fallback', fallback: 'Disable fallback execution paths.' },
    { flag: '--mmap', fallback: 'Memory-map model weights from disk.' },
    { flag: '--no-mmap', fallback: 'Disable memory mapping.' },
    { flag: '--offload-to-cpu', fallback: 'Offload model work to CPU.' },
    { flag: '--clip-on-cpu', fallback: 'Run CLIP on CPU.' },
    { flag: '--vae-on-cpu', fallback: 'Run VAE on CPU.' },
    { flag: '--vae-tiling', fallback: 'Use tiled VAE decoding to reduce VRAM usage.' },
    { flag: '--free-params-immediately', fallback: 'Free model params after load.' },
    { flag: '--keep-clip-on-cpu', fallback: 'Keep CLIP weights on CPU.' },
    { flag: '--keep-control-net-cpu', fallback: 'Keep ControlNet weights on CPU.' },
    { flag: '--keep-vae-on-cpu', fallback: 'Keep VAE weights on CPU.' },
    { flag: '--control-net-cpu', fallback: 'Run ControlNet on CPU when ControlNet is used.' },
    { flag: '--canny', fallback: 'Apply Canny preprocessing for ControlNet.' },
    { flag: '--color', fallback: 'Apply color preprocessing or colored output.' },
    { flag: '--cpu-params', fallback: 'Keep parameters in regular CPU memory.' },
    { flag: '--normalize-input', fallback: 'Normalize input image values.' },
    { flag: '--upscale-model path', fallback: 'Set ESRGAN upscale model path.' },
    { flag: '--upscale-repeats 2', fallback: 'Repeat upscaling passes.' },
    { flag: '--type q8_0', fallback: 'Set weight precision/type.' },
    { flag: '--rng cuda', fallback: 'Prefer CUDA RNG on NVIDIA systems.' },
    { flag: '--prediction v', fallback: 'Set prediction mode.' },
    { flag: '--guidance 3.5', fallback: 'Set guidance scale.' },
    { flag: '--eta 0', fallback: 'Set DDIM eta.' },
    { flag: '--pm-style-strength 20', fallback: 'Set PhotoMaker style strength.' },
    { flag: '--control-strength 0.9', fallback: 'Set ControlNet strength.' },
    { flag: '--video-frames 16', fallback: 'Set generated video frame count.' },
    { flag: '--fps 24', fallback: 'Set generated video FPS.' },
    { flag: '--motion-bucket-id 127', fallback: 'Set SVD motion bucket.' },
    { flag: '--augmentation-level 0', fallback: 'Set SVD augmentation level.' },
    { flag: '--sample-start 0', fallback: 'Set sample start value.' },
    { flag: '--sample-end 1', fallback: 'Set sample end value.' },
    { flag: '--slg-scale 0', fallback: 'Set skip-layer guidance scale.' },
    { flag: '--skip-layers 7,8,9', fallback: 'Set skip-layer guidance layers.' },
    { flag: '--skip-layer-start 0.01', fallback: 'Set skip-layer start ratio.' },
    { flag: '--skip-layer-end 0.2', fallback: 'Set skip-layer end ratio.' },
    { flag: '--vae-tile-size 32x32', fallback: 'Set VAE tile size.' },
    { flag: '--vae-tile-overlap 0.5', fallback: 'Set VAE tile overlap.' },
    { flag: '--vae-relative-tile-size 0.5x0.5', fallback: 'Set relative VAE tile size.' },
    { flag: '--verbose', fallback: 'Enable verbose logging.' },
    { flag: '--quiet', fallback: 'Reduce logging output.' },
    { flag: '--chroma-disable-ds', fallback: 'Disable Chroma downsampling.' },
    { flag: '--chroma-enable-t5-mask', fallback: 'Enable Chroma T5 mask.' },
    { flag: '--chroma-t5-mask-pad 1', fallback: 'Set Chroma T5 mask padding.' },
    { flag: '--flow-shift 3', fallback: 'Set flow shift value.' },
    { flag: '--timestep-shift 250', fallback: 'Set shifted timestep value.' },
    { flag: '--diffusion-cpu-params', fallback: 'Keep diffusion params on CPU.' },
    { flag: '--vae-cpu-params', fallback: 'Keep VAE params on CPU.' },
    { flag: '--clip-cpu-params', fallback: 'Keep CLIP params on CPU.' },
    { flag: '--control-net-cpu-params', fallback: 'Keep ControlNet params on CPU.' },
    { flag: '--rng std_default', fallback: 'Use standard RNG.' },
    { flag: '--sampler-rng cuda', fallback: 'Use CUDA RNG specifically for the sampler.' },
    { flag: '--load-id-weights path', fallback: 'Load ID weights file.' },
    { flag: '--photo-maker path', fallback: 'Set PhotoMaker model path.' },
    { flag: '--photo-maker-vae path', fallback: 'Set PhotoMaker VAE path.' },
    { flag: '--style-strength 20', fallback: 'Set PhotoMaker style strength.' },
    { flag: '--taesd-decode', fallback: 'Use TAESD decoder.' },
    { flag: '--taesd-encode', fallback: 'Use TAESD encoder.' },
];

export type EngineRecommendedExtraArgsContext = {
    config?: {
        extra_args?: string[];
    } | null;
    currentGroups?: string[];
    settings?: Record<string, unknown>;
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

export function getEngineModelFileName(modelPath: string, notSelectedLabel: string): string {
    if (modelPath.trim() === '') {
        return notSelectedLabel;
    }

    const normalized = modelPath.replaceAll('\\', '/');
    return normalized.split('/').pop() ?? modelPath;
}

export function getEngineModelFileFilters(
    _fileKind: EngineModelFileKind,
    isImage: boolean,
): EngineModelFileFilter[] {
    if (isImage) {
        return [
            { name: 'SD Models', extensions: ['gguf', 'safetensors'] },
            { name: 'GGUF Models', extensions: ['gguf'] },
            { name: 'SafeTensors', extensions: ['safetensors'] },
        ];
    }

    return [{ name: 'GGUF Models', extensions: ['gguf'] }];
}

export function createEngineExtraArgsField(translate: ExtraArgsTranslate): EngineExtraArgsControl {
    const root = document.createElement('div');
    root.className = 'local-engine-tags-editor';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.className = 'local-engine-extra-args-input local-engine-extra-args-value';

    const chips = document.createElement('div');
    chips.className = 'local-engine-extra-args-chips';

    const draftInput = document.createElement('input');
    draftInput.type = 'text';
    draftInput.className = 'local-engine-extra-args-draft';
    draftInput.placeholder = translate(
        'ui.settings.engine.extra_args.placeholder',
        'Add startup flags',
    );

    let groups: string[] = [];

    const parseGroups = (raw: string): string[] => {
        const tokens = tokenizeEngineExtraArgs(raw);
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
            .flatMap((group) => tokenizeEngineExtraArgs(group))
            .map(formatEngineExtraArgToken)
            .join(' ');

    const commitHiddenValue = () => {
        input.value = flattenGroups(groups);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const renderChips = () => {
        chips.replaceChildren(
            ...groups.map((group, index) => {
                const chip = document.createElement('span');
                chip.className = 'local-engine-extra-arg-chip';

                const edit = document.createElement('button');
                edit.type = 'button';
                edit.className = 'local-engine-extra-arg-edit';
                edit.textContent = group;
                edit.title = group;
                edit.addEventListener('click', () => {
                    groups.splice(index, 1);
                    draftInput.value = group;
                    renderChips();
                    commitHiddenValue();
                    draftInput.focus();
                });

                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'local-engine-extra-arg-remove';
                remove.textContent = '×';
                remove.setAttribute(
                    'aria-label',
                    translate('ui.settings.engine.extra_args.remove', 'Remove'),
                );
                remove.addEventListener('click', () => {
                    groups.splice(index, 1);
                    renderChips();
                    commitHiddenValue();
                });

                chip.append(edit, remove);
                return chip;
            }),
        );
    };

    const commitDraft = () => {
        const nextGroups = parseGroups(draftInput.value);
        if (nextGroups.length === 0) {
            return;
        }

        const seen = new Set(groups);
        nextGroups.forEach((group) => {
            if (!seen.has(group)) {
                seen.add(group);
                groups.push(group);
            }
        });
        draftInput.value = '';
        renderChips();
        commitHiddenValue();
    };

    const getGroups = (): string[] => [...groups, ...parseGroups(draftInput.value)];

    const syncTokens = () => {
        groups = parseGroups(input.value);
        draftInput.value = '';
        renderChips();
        input.value = flattenGroups(groups);
    };

    const setGroups = (newGroups: string[], options: { emit?: boolean } = {}) => {
        input.value = flattenGroups(newGroups);
        syncTokens();
        if (options.emit === false) {
            return;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    draftInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commitDraft();
        }
        if (event.key === 'Backspace' && draftInput.value === '' && groups.length > 0) {
            draftInput.value = groups.pop() ?? '';
            renderChips();
            commitHiddenValue();
        }
    });
    draftInput.addEventListener('blur', commitDraft);

    root.addEventListener('click', (event) => {
        if (event.target === root || event.target === chips) {
            draftInput.focus();
        }
    });

    root.append(input, chips, draftInput);

    return { input, root, syncTokens, getGroups, setGroups };
}

export function getEngineExtraArgDocs(
    appId: string,
    translate: ExtraArgsTranslate = (_key, fallback) => fallback,
): EngineExtraArgDocs {
    if (appId === 'sdcpp' || appId === 'stable-diffusion') {
        return {
            title: translate('ui.settings.engine.sdcpp_flags.title', 'Manual sd.cpp flags'),
            subtitle: translate(
                'ui.settings.engine.sdcpp_flags.subtitle',
                'Startup flags appended to sd-server.',
            ),
            items: buildEngineExtraArgDocs(
                'ui.settings.engine.sdcpp_flag',
                SDCPP_EXTRA_ARG_DOCS,
                translate,
            ),
        };
    }

    return {
        title: 'Manual llama.cpp flags',
        subtitle:
            'These are appended to llama-server startup. Context window and compute device are already managed by the launcher UI.',
        items: [
            { flag: '--flash-attn', description: 'Enable flash attention if supported.' },
            { flag: '--threads 8', description: 'Set explicit CPU thread count.' },
            { flag: '--parallel 1', description: 'Limit parallel slots for stability.' },
            { flag: '--mlock', description: 'Keep model memory pinned in RAM.' },
            { flag: '--no-mmap', description: 'Disable mmap if storage causes issues.' },
        ],
    };
}

function buildEngineExtraArgDocs(
    prefix: string,
    docs: EngineExtraArgDocSource[],
    translate: ExtraArgsTranslate,
): EngineExtraArgDoc[] {
    return [...docs]
        .sort((left, right) => left.flag.localeCompare(right.flag, 'en', { sensitivity: 'base' }))
        .map((doc) => ({
            flag: doc.flag,
            description: translate(`${prefix}.${getEngineExtraArgKey(doc.flag)}`, doc.fallback),
        }));
}

function getEngineExtraArgKey(flag: string): string {
    return flag
        .toLowerCase()
        .replace(/^--/, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

export function getEngineRecommendedExtraArgs(
    appId: string,
    context: EngineRecommendedExtraArgsContext = {},
): string[] {
    if (appId !== 'sdcpp' && appId !== 'stable-diffusion') {
        return ['--flash-attn'];
    }

    const recommended = ['--diffusion-fa', '--mmap'];
    if (isHighResolutionImageGeneration(appId, context.settings)) {
        recommended.push('--vae-tiling');
    }
    return recommended;
}

function isHighResolutionImageGeneration(
    appId: string,
    settings: Record<string, unknown> | undefined,
): boolean {
    const width = readPositiveNumber(settings?.[`${appId}_width`]);
    const height = readPositiveNumber(settings?.[`${appId}_height`]);
    if (width === null || height === null) {
        return false;
    }

    return width * height >= 1024 * 1024 || Math.max(width, height) >= 1024;
}

function readPositiveNumber(value: unknown): number | null {
    const parsed =
        typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
            return tokenizeEngineExtraArgs(value);
        }
        return [];
    }

    return value;
}

export function tokenizeEngineExtraArgs(raw: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;

    for (let index = 0; index < raw.length; index += 1) {
        const char = raw[index] ?? '';
        if (quote !== null && char === '\\') {
            const nextChar = raw[index + 1];
            if (nextChar === quote || nextChar === '\\') {
                current += nextChar;
                index += 1;
            } else {
                current += char;
            }
            continue;
        }

        if ((char === '"' || char === "'") && (quote === null || quote === char)) {
            quote = quote === null ? char : null;
            continue;
        }

        if (quote === null && /\s/.test(char)) {
            if (current !== '') {
                tokens.push(current);
                current = '';
            }
            continue;
        }

        current += char;
    }

    if (current !== '') {
        tokens.push(current);
    }

    return tokens;
}

function formatEngineExtraArgToken(token: string): string {
    if (token === '') {
        return '""';
    }

    if (!/\s|["']/.test(token)) {
        return token;
    }

    return `"${token.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
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
    settings: Record<string, string | number | null | undefined>,
): void {
    const value = settings[key];
    // Some persisted settings stored the literal "null"; keep empty defaults empty.
    if (value !== undefined && value !== null && !(value === 'null' && defaultValue === '')) {
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
