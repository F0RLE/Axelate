import DOMPurify from 'dompurify';
import { open } from '@tauri-apps/plugin-dialog';

import { tracer } from '@/infrastructure/logging/LoggerService';
import type { IApp } from '@/shared/types/coreTypes';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { SettingsService } from '../services/SettingsService';
import type { EngineConfigService, EngineConfig } from '@/features/ai/services/EngineConfigService';
import type { IModuleSettingsUIContext } from './SettingsContext';

type EngineFieldType = 'number' | 'text' | 'select' | 'password' | 'textarea';
type EngineInputElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type CustomSelectControl = {
    input: HTMLInputElement;
    root: HTMLDivElement;
    syncDisplay: () => void;
    destroy: () => void;
};
type ExtraArgsControl = {
    input: HTMLInputElement;
    root: HTMLDivElement;
    syncTokens: () => void;
    getGroups: () => string[];
    setGroups: (groups: string[]) => void;
};
type EngineExtraArgDoc = {
    flag: string;
    description: string;
};

type ModuleSettingsEngineRendererDeps = {
    service: SettingsService;
    tauri: TauriProvider;
    engineConfigService: EngineConfigService;
    getContext: () => IModuleSettingsUIContext;
    registerCleanup: (cleanup: () => void) => void;
    debouncedSave: (key: string, value: string | number | boolean | null) => void;
    showSaveIndicator: () => void;
};

export class ModuleSettingsEngineRenderer {
    private readonly _extraArgsControls = new Map<string, ExtraArgsControl>();
    private _activeEngineInfoPopover: HTMLDivElement | null = null;
    private _activeEngineInfoCleanup: (() => void) | null = null;

    constructor(private readonly _deps: ModuleSettingsEngineRendererDeps) {}

    private get _context(): IModuleSettingsUIContext {
        return this._deps.getContext();
    }

    public reset(): void {
        this._closeEngineInfoPopover();
        this._extraArgsControls.clear();
    }

    public async render(container: HTMLElement, app: IApp): Promise<void> {
        const t = this._context.t;
        container.innerHTML = '';

        const payload = await this._deps.engineConfigService.getSettingsPayload(app.id);
        const config = payload?.config ?? null;
        const isImage = app.capability === 'image';
        const modelPlaceholder = isImage
            ? String.raw`e.g. C:\Models\model.gguf or model.safetensors`
            : String.raw`e.g. C:\Models\model.gguf`;
        const rawHtml = this._getEngineConfigHtml(app, config);

        const purifyConfig = {
            ALLOW_DATA_ATTR: true,
            ALLOWED_TAGS: [
                'div',
                'section',
                'h3',
                'h4',
                'span',
                'p',
                'input',
                'button',
                'label',
                'ul',
                'li',
                'strong',
            ],
            ALLOWED_ATTR: [
                'class',
                'id',
                'data-provider-id',
                'data-i18n',
                'data-status',
                'style',
                'aria-labelledby',
                'type',
                'placeholder',
                'value',
                'min',
                'max',
                'step',
            ],
        };

        container.innerHTML = DOMPurify.sanitize(rawHtml, purifyConfig);

        const corePrimary = container.querySelector(`#local-engine-core-primary-${app.id}`);
        if (!(corePrimary instanceof HTMLElement)) return;

        if (isImage) {
            const splitRow = document.createElement('div');
            splitRow.className = 'local-engine-split-row';

            this._renderEngineFieldRow(splitRow, {
                label: t('ui.settings.engine.model_path', 'Model Path (*.gguf, *.safetensors)'),
                key: 'model_path',
                type: 'text',
                isEngineConfig: true,
                placeholder: modelPlaceholder,
                isFile: true,
                isImage,
                appId: app.id,
                config,
            });

            this._renderPerformanceModeFieldRow(splitRow, app.id);
            corePrimary.appendChild(splitRow);
        } else {
            this._renderEngineFieldRow(corePrimary, {
                label: t('ui.settings.engine.model_path', 'Model Path (*.gguf, *.safetensors)'),
                key: 'model_path',
                type: 'text',
                isEngineConfig: true,
                placeholder: modelPlaceholder,
                isFile: true,
                isImage,
                fullWidth: true,
                appId: app.id,
                config,
            });
        }

        if (isImage) {
            this._renderEngineFieldRow(corePrimary, {
                label: t('ui.settings.engine.extra_args', 'Extra Arguments'),
                key: 'extra_args',
                type: 'text',
                isEngineConfig: true,
                placeholder: 'e.g. --vae-tiling --fa --rng cuda',
                defaultValue: '',
                fullWidth: true,
                showInfoButton: true,
                appId: app.id,
                config,
            });

            const promptsGroup = container.querySelector(`#local-engine-prompts-${app.id}`);
            const sizeGroup = container.querySelector(`#local-engine-size-${app.id}`);
            const samplingGroup = container.querySelector(`#local-engine-sampling-${app.id}`);
            const batchGroup = container.querySelector(`#local-engine-batch-${app.id}`);
            if (
                !(promptsGroup instanceof HTMLElement) ||
                !(sizeGroup instanceof HTMLElement) ||
                !(samplingGroup instanceof HTMLElement) ||
                !(batchGroup instanceof HTMLElement)
            ) {
                return;
            }

            this._renderEngineFieldRow(promptsGroup, {
                label: t('ui.settings.engine.sd_positive_prompt', 'Positive Prompt Prefix'),
                key: `${app.id}_positive_prompt`,
                type: 'textarea',
                isEngineConfig: false,
                placeholder: 'e.g. score_9, score_8_up...',
                defaultValue: '',
                appId: app.id,
                config,
            });
            this._renderEngineFieldRow(promptsGroup, {
                label: t('ui.settings.engine.sd_negative_prompt', 'Negative Prompt Prefix'),
                key: `${app.id}_negative_prompt`,
                type: 'textarea',
                isEngineConfig: false,
                placeholder: 'e.g. score_4, text, watermark...',
                defaultValue: '',
                appId: app.id,
                config,
            });
            this._syncPromptTextareaHeights(promptsGroup);
            this._renderEngineFieldRow(sizeGroup, {
                label: t('ui.settings.engine.sd_width', 'Width (px)'),
                key: `${app.id}_width`,
                type: 'number',
                isEngineConfig: false,
                placeholder: '512',
                defaultValue: 512,
                min: 256,
                max: 4096,
                appId: app.id,
                config,
            });
            this._renderEngineFieldRow(sizeGroup, {
                label: t('ui.settings.engine.sd_height', 'Height (px)'),
                key: `${app.id}_height`,
                type: 'number',
                isEngineConfig: false,
                placeholder: '512',
                defaultValue: 512,
                min: 256,
                max: 4096,
                appId: app.id,
                config,
            });
            this._renderEngineFieldRow(samplingGroup, {
                label: t('ui.settings.engine.sd_steps', 'Steps'),
                key: `${app.id}_steps`,
                type: 'number',
                isEngineConfig: false,
                placeholder: '20',
                defaultValue: 20,
                min: 1,
                max: 100,
                appId: app.id,
                config,
            });
            this._renderEngineFieldRow(samplingGroup, {
                label: t('ui.settings.engine.sd_cfg', 'CFG'),
                key: `${app.id}_cfg_scale`,
                type: 'number',
                isEngineConfig: false,
                placeholder: '7.0',
                defaultValue: 7,
                min: 1,
                max: 30,
                appId: app.id,
                config,
            });
            this._renderEngineFieldRow(samplingGroup, {
                label: t('ui.settings.engine.sd_sampler', 'Sampler'),
                key: `${app.id}_sampler`,
                type: 'select',
                isEngineConfig: false,
                options: [
                    'dpm++ 2m',
                    'dpm++ 2m v2',
                    'dpm++ 2s a',
                    'euler a',
                    'heun',
                    'dpm2',
                    'euler',
                    'ipndm',
                    'ipndm_v',
                    'dpm2 a',
                    'ddim trailing',
                    'res multistep',
                    'res 2s',
                    'lcm',
                    'tcd',
                ],
                defaultValue: 'euler a',
                appId: app.id,
                config,
            });
            this._renderEngineFieldRow(samplingGroup, {
                label: t('ui.settings.engine.sd_scheduler', 'Scheduler'),
                key: `${app.id}_scheduler`,
                type: 'select',
                isEngineConfig: false,
                options: [
                    'discrete',
                    'karras',
                    'sgm uniform',
                    'exponential',
                    'ays',
                    'gits',
                    'smoothstep',
                    'kl optimal',
                    'simple',
                    'lcm',
                    'bong tangent',
                ],
                defaultValue: 'discrete',
                appId: app.id,
                config,
            });
            this._renderEngineFieldRow(batchGroup, {
                label: t('ui.settings.engine.sd_seed', 'Seed'),
                key: `${app.id}_seed`,
                type: 'number',
                isEngineConfig: false,
                placeholder: '-1',
                defaultValue: -1,
                min: -1,
                appId: app.id,
                config,
            });
            this._renderEngineFieldRow(batchGroup, {
                label: t('ui.settings.engine.sd_clip_skip', 'Clip Skip'),
                key: `${app.id}_clip_skip`,
                type: 'number',
                isEngineConfig: false,
                placeholder: '-1',
                defaultValue: -1,
                min: -1,
                max: 12,
                appId: app.id,
                config,
            });
            this._renderEngineFieldRow(batchGroup, {
                label: t('ui.settings.engine.sd_batch_size', 'Batch Size'),
                key: `${app.id}_batch_size`,
                type: 'number',
                isEngineConfig: false,
                placeholder: '1',
                defaultValue: 1,
                min: 1,
                max: 8,
                appId: app.id,
                config,
            });
            return;
        }

        this._renderEngineFieldRow(corePrimary, {
            label: t('ui.settings.engine.gpu_layers', 'GPU Layers'),
            key: 'gpu_layers',
            type: 'number',
            isEngineConfig: true,
            placeholder: 'e.g. -1',
            defaultValue: -1,
            min: -1,
            max: 999,
            appId: app.id,
            config,
        });
        this._renderEngineFieldRow(corePrimary, {
            label: t('ui.settings.engine.context_size', 'Context Window'),
            key: 'context_size',
            type: 'number',
            isEngineConfig: true,
            placeholder: 'e.g. 4096',
            defaultValue: 4096,
            min: 512,
            max: 128000,
            appId: app.id,
            config,
        });
    }

    private _syncPromptTextareaHeights(container: HTMLElement): void {
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
            this._deps.registerCleanup(() => {
                textarea.removeEventListener('input', sync);
            });
        });

        requestAnimationFrame(sync);
    }

    private _escapeHtml(value: string): string {
        return value
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    private _getModelFileName(modelPath: string): string {
        if (modelPath.trim() === '') {
            return this._context.t('ui.settings.engine.model_not_selected', 'Model not selected');
        }
        const normalized = modelPath.replaceAll('\\', '/');
        return normalized.split('/').pop() ?? modelPath;
    }

    private _getEngineConfigHtml(app: IApp, config: EngineConfig | null): string {
        const t = this._context.t;
        const isImage = app.capability === 'image';
        const warnHtml =
            config === null
                ? `<p class="local-engine-warning">${this._escapeHtml(t('ui.settings.engine.config_unavailable', 'Engine config unavailable (Tauri not connected)'))}</p>`
                : '';
        const generationSection = isImage
            ? `
                <section class="thinking-level-section local-engine-section" aria-labelledby="${app.id}-generation-title">
                    <div class="ai-content-panel">
                        <div class="local-engine-section-header">
                            <h3 id="${app.id}-generation-title">🎛️ ${this._escapeHtml(
                                t('ui.settings.engine.generation_presets', 'Generation Presets'),
                            )}</h3>
                        </div>
                        <div class="local-engine-generation-grid local-engine-generation-grid--image">
                            <div class="local-engine-panel-card local-engine-panel-card--prompts">
                                <div id="local-engine-prompts-${app.id}" class="local-engine-field-grid"></div>
                            </div>
                            <div class="local-engine-control-grid">
                                <div class="local-engine-panel-card local-engine-panel-card--compact">
                                    <div class="local-engine-group-header">
                                        <h4>${this._escapeHtml(
                                            t('ui.settings.engine.group_size', 'Image Size'),
                                        )}</h4>
                                    </div>
                                    <div class="local-engine-group-body">
                                        <div id="local-engine-size-${app.id}" class="local-engine-field-grid"></div>
                                    </div>
                                </div>
                                <div class="local-engine-panel-card local-engine-panel-card--compact">
                                    <div class="local-engine-group-header">
                                        <h4>${this._escapeHtml(
                                            t('ui.settings.engine.group_sampling', 'Sampling'),
                                        )}</h4>
                                    </div>
                                    <div class="local-engine-group-body">
                                        <div id="local-engine-sampling-${app.id}" class="local-engine-field-grid"></div>
                                    </div>
                                </div>
                                <div class="local-engine-panel-card local-engine-panel-card--compact">
                                    <div class="local-engine-group-header">
                                        <h4>${this._escapeHtml(
                                            t('ui.settings.engine.group_batch', 'Batch & Seed'),
                                        )}</h4>
                                    </div>
                                    <div class="local-engine-group-body">
                                        <div id="local-engine-batch-${app.id}" class="local-engine-field-grid"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            `
            : '';

        return `
            <div class="ai-module-config universal-api-theme local-engine-config" data-provider-id="${this._escapeHtml(app.id)}">
                <div class="ai-settings-content local-engine-layout">
                    <section class="thinking-level-section local-engine-section" aria-labelledby="${app.id}-core-title">
                        <div class="ai-content-panel">
                            <div class="local-engine-section-header">
                                <h3 id="${app.id}-core-title">🧩 ${this._escapeHtml(
                                    t('ui.settings.engine.core_config', 'Core Config'),
                                )}</h3>
                            </div>
                            <div id="local-engine-core-primary-${app.id}" class="local-engine-field-stack local-engine-field-stack--tight"></div>
                            ${warnHtml}
                        </div>
                    </section>
                    ${generationSection}
                </div>
            </div>
        `;
    }

    private _createEngineFieldControl(options: {
        type: EngineFieldType;
        key: string;
        isEngineConfig: boolean;
        appId: string;
        placeholder?: string;
        min?: number;
        max?: number;
        options?: string[];
    }): {
        input: HTMLElement;
        engineInput: EngineInputElement;
        customSelect: CustomSelectControl | null;
        extraArgsControl: ExtraArgsControl | null;
    } {
        if (options.type === 'select') {
            const customSelect = this._createCustomSelectField(options);
            return {
                input: customSelect.root,
                engineInput: customSelect.input,
                customSelect,
                extraArgsControl: null,
            };
        }

        if (options.isEngineConfig && options.key === 'extra_args') {
            const extraArgsControl = this._createExtraArgsField();
            this._extraArgsControls.set(options.appId, extraArgsControl);
            return {
                input: extraArgsControl.root,
                engineInput: extraArgsControl.input,
                customSelect: null,
                extraArgsControl,
            };
        }

        if (options.type === 'textarea') {
            const input = this._createTextAreaField(options);
            return { input, engineInput: input, customSelect: null, extraArgsControl: null };
        }

        const input = this._createTextInputField(options);
        return { input, engineInput: input, customSelect: null, extraArgsControl: null };
    }

    private _renderEngineFieldRow(
        container: HTMLElement,
        options: {
            label: string;
            key: string;
            type: EngineFieldType;
            isEngineConfig: boolean;
            placeholder?: string;
            defaultValue?: number | string;
            options?: string[];
            min?: number;
            max?: number;
            isFile?: boolean;
            isImage?: boolean;
            description?: string;
            fullWidth?: boolean;
            showInfoButton?: boolean;
            appId: string;
            config: EngineConfig | null;
        },
    ): void {
        const row = document.createElement('div');
        row.className = `local-engine-field-row${options.fullWidth === true ? ' full-width' : ''}`;

        const labelRow = document.createElement('div');
        labelRow.className = 'local-engine-label-row';

        const label = document.createElement('label');
        label.textContent = options.label;
        label.className = 'local-engine-field-label';
        labelRow.appendChild(label);

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'local-engine-input-row';

        const { input, engineInput, customSelect, extraArgsControl } =
            this._createEngineFieldControl(options);

        this._setupEngineFieldInitialValue(engineInput, options);
        this._setupEngineFieldEvents(engineInput, options);

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
                engineInput.value = this._getModelFileName(engineInput.value);
            }
        }

        inputWrapper.appendChild(input);

        if (options.isFile === true && this._deps.tauri.isTauri()) {
            this._addFileBrowseButton(
                inputWrapper,
                engineInput as HTMLInputElement,
                options.isImage ?? false,
            );
        }

        if (options.showInfoButton === true) {
            const infoBtn = document.createElement('button');
            infoBtn.type = 'button';
            infoBtn.className = 'local-engine-info-btn';
            const infoText = this._context.t(
                'ui.settings.engine.extra_args.info',
                'Extra arguments info',
            );
            infoBtn.setAttribute('aria-label', infoText);
            infoBtn.title = infoText;
            infoBtn.textContent = '+';
            infoBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this._toggleEngineInfoPopover(infoBtn, options.appId);
            });
            inputWrapper.appendChild(infoBtn);

            if (
                options.isEngineConfig &&
                options.key === 'extra_args' &&
                extraArgsControl !== null
            ) {
                extraArgsControl.root.style.cursor = 'pointer';
                extraArgsControl.root.addEventListener('click', (event) => {
                    const target = event.target as Node;
                    if (target === extraArgsControl.root || target === extraArgsControl.root.firstChild) {
                        event.preventDefault();
                        event.stopPropagation();
                        this._toggleEngineInfoPopover(infoBtn, options.appId);
                    }
                });
            }
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

    private _renderPerformanceModeFieldRow(container: HTMLElement, appId: string): void {
        const row = document.createElement('div');
        row.className = 'local-engine-field-row';

        const labelRow = document.createElement('div');
        labelRow.className = 'local-engine-label-row';

        const label = document.createElement('label');
        label.textContent = this._context.t(
            'ui.settings.engine.performance_mode',
            'Performance Mode',
        );
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

        const settings = this._deps.service.getSettings() as Record<string, string | boolean | undefined>;
        let enabled =
            String(settings[`${appId}_performance_mode`] ?? 'false').toLowerCase() === 'true';

        const sync = () => {
            statusLabel.textContent = enabled
                ? this._context.t('ui.common.enabled', 'Enabled')
                : this._context.t('ui.common.disabled', 'Disabled');
            inputWrapper.classList.toggle('is-enabled', enabled);
            checkbox.checked = enabled;
        };
        sync();

        inputWrapper.addEventListener('click', () => {
            enabled = !enabled;
            sync();
            this._deps.debouncedSave(`${appId}_performance_mode`, enabled);
        });

        row.append(labelRow, inputWrapper);
        container.appendChild(row);
    }

    private _createExtraArgsField(): ExtraArgsControl {
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
            chips.innerHTML = '';
            getGroups().forEach((group, index) => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'local-engine-tag-chip';
                chip.title = this._context.t('ui.settings.engine.extra_args.remove', 'Remove');

                const label = document.createElement('span');
                label.className = 'local-engine-tag-chip-label';
                label.textContent = group;

                const remove = document.createElement('span');
                remove.className = 'local-engine-tag-chip-remove';
                remove.textContent = 'x';

                chip.append(label, remove);
                chip.addEventListener('click', () => {
                    const updated = getGroups().filter((_, groupIndex) => groupIndex !== index);
                    setGroups(updated);
                });
                chips.appendChild(chip);
            });
        };

        const setGroups = (groups: string[]) => {
            hiddenInput.value = flattenGroups(groups);
            syncTokens();
            hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        };

        root.append(chips, hiddenInput);

        return { input: hiddenInput, root, syncTokens, getGroups, setGroups };
    }

    private _appendExtraArgs(appId: string, groups: string[]): number {
        const control = this._extraArgsControls.get(appId);
        if (control === undefined) return 0;

        const nextGroups = [...control.getGroups()];
        const seen = new Set(nextGroups);
        let added = 0;

        groups.forEach((group) => {
            if (!seen.has(group)) {
                seen.add(group);
                nextGroups.push(group);
                added += 1;
            }
        });

        if (added > 0) {
            control.setGroups(nextGroups);
        }

        return added;
    }

    private _toggleEngineInfoPopover(anchor: HTMLButtonElement, appId: string): void {
        if (this._activeEngineInfoPopover !== null) {
            if (this._activeEngineInfoPopover.dataset['appId'] === appId) {
                this._closeEngineInfoPopover();
                return;
            }
            this._closeEngineInfoPopover();
        }

        this._openEngineInfoPopover(anchor, appId);
    }

    private _openEngineInfoPopover(anchor: HTMLButtonElement, appId: string): void {
        const docs = this._getEngineExtraArgDocs(appId);
        const popover = document.createElement('div');
        popover.className = 'local-engine-args-popover';
        popover.dataset['appId'] = appId;

        const title = document.createElement('div');
        title.className = 'local-engine-args-popover-title';
        title.textContent = docs.title;

        const subtitle = document.createElement('p');
        subtitle.className = 'local-engine-args-popover-subtitle';
        subtitle.textContent = docs.subtitle;

        const actions = document.createElement('div');
        actions.className = 'local-engine-args-popover-actions';

        const addAllBtn = document.createElement('button');
        addAllBtn.type = 'button';
        addAllBtn.className = 'local-engine-args-copy-all';
        addAllBtn.textContent = this._context.t('ui.settings.engine.extra_args.add_all', 'Add all');
        addAllBtn.addEventListener('click', () => {
            const added = this._appendExtraArgs(
                appId,
                docs.items.map((item) => item.flag),
            );
            this._context.showToast(
                added > 0
                    ? this._context.t(
                          'ui.settings.engine.extra_args.add_all_success',
                          'Arguments added',
                      )
                    : this._context.t(
                          'ui.settings.engine.extra_args.add_all_exists',
                          'Arguments already added',
                      ),
                added > 0 ? 'success' : 'info',
            );
        });
        actions.appendChild(addAllBtn);

        const list = document.createElement('div');
        list.className = 'local-engine-args-list';

        docs.items.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'local-engine-args-item';
            row.tabIndex = 0;
            row.setAttribute('role', 'button');
            row.setAttribute(
                'aria-label',
                this._context
                    .t('ui.settings.engine.extra_args.add_flag', 'Add {flag}')
                    .replace('{flag}', item.flag),
            );

            const meta = document.createElement('div');
            meta.className = 'local-engine-args-item-meta';

            const flag = document.createElement('code');
            flag.className = 'local-engine-args-flag';
            flag.textContent = item.flag;

            const desc = document.createElement('p');
            desc.className = 'local-engine-args-desc';
            desc.textContent = item.description;

            meta.append(flag, desc);

            const addFlag = () => {
                const added = this._appendExtraArgs(appId, [item.flag]);
                this._context.showToast(
                    (added > 0
                        ? this._context.t(
                              'ui.settings.engine.extra_args.flag_added',
                              '{flag} added',
                          )
                        : this._context.t(
                              'ui.settings.engine.extra_args.flag_exists',
                              '{flag} already added',
                          )
                    ).replace('{flag}', item.flag),
                    added > 0 ? 'success' : 'info',
                );
            };

            row.addEventListener('click', addFlag);
            row.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    addFlag();
                }
            });

            row.appendChild(meta);
            list.appendChild(row);
        });

        popover.append(title, subtitle, actions, list);
        const modal = document.getElementById('module-settings-modal');
        if (modal === null) {
            document.body.appendChild(popover);
        } else {
            modal.appendChild(popover);
            modal.classList.add('popover-open');
        }

        popover.style.opacity = '0';
        popover.style.transition = 'opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (popover.isConnected) {
                    popover.style.opacity = '1';
                }
            });
        });

        const updatePosition = () => {
            const appModal = modal?.querySelector('.app-modal');
            const targetRect = (appModal ?? modal ?? document.body).getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const panelWidth = 328;
            const margin = 16;

            let panelLeft = targetRect.right + 16;
            if (panelLeft + panelWidth > viewportWidth - margin) {
                panelLeft = Math.max(margin, viewportWidth - panelWidth - margin);
            }

            popover.style.width = `${panelWidth}px`;
            popover.style.left = `${panelLeft}px`;
            popover.style.top = `${targetRect.top}px`;
            popover.style.height = `${targetRect.height}px`;
        };

        const handleDocumentClick = (event: MouseEvent) => {
            const target = event.target as Node;
            if (!popover.contains(target) && !anchor.contains(target)) {
                this._closeEngineInfoPopover();
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                this._closeEngineInfoPopover();
            }
        };

        const handleReposition = () => {
            if (this._activeEngineInfoPopover === popover) {
                if (modal !== null) {
                    modal.classList.add('popover-open');
                }
                updatePosition();
            }
        };

        document.addEventListener('click', handleDocumentClick, true);
        document.addEventListener('keydown', handleEscape);
        window.addEventListener('resize', handleReposition);
        window.addEventListener('scroll', handleReposition, true);

        this._activeEngineInfoPopover = popover;
        this._activeEngineInfoCleanup = () => {
            document.removeEventListener('click', handleDocumentClick, true);
            document.removeEventListener('keydown', handleEscape);
            window.removeEventListener('resize', handleReposition);
            window.removeEventListener('scroll', handleReposition, true);
        };

        const startTime = performance.now();
        const syncAnimation = (time: number) => {
            if (this._activeEngineInfoPopover === popover) {
                updatePosition();
                if (time - startTime < 400) {
                    requestAnimationFrame(syncAnimation);
                }
            }
        };
        requestAnimationFrame(syncAnimation);
    }

    private _closeEngineInfoPopover(): void {
        this._activeEngineInfoCleanup?.();
        this._activeEngineInfoCleanup = null;

        const popover = this._activeEngineInfoPopover;
        this._activeEngineInfoPopover = null;

        const modal = document.getElementById('module-settings-modal');
        if (modal !== null) {
            modal.classList.remove('popover-open');
        }

        popover?.remove();
    }

    private _getEngineExtraArgDocs(appId: string): {
        title: string;
        subtitle: string;
        items: EngineExtraArgDoc[];
    } {
        if (appId === 'sdcpp' || appId === 'stable-diffusion') {
            return {
                title: 'Manual sd.cpp flags',
                subtitle:
                    'These go into Extra Arguments as startup flags. Generation fields like steps, sampler, scheduler and seed are already controlled by the launcher UI.',
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

    private _createCustomSelectField(options: { options?: string[] }): CustomSelectControl {
        const root = document.createElement('div');
        root.className = 'local-engine-select';
        const overlayHost: HTMLElement =
            document.getElementById('module-settings-modal') ?? document.body;
        const controller = new AbortController();
        const signal = controller.signal;

        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.className = 'local-engine-select-value';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'local-engine-select-trigger';

        const valueEl = document.createElement('span');
        valueEl.className = 'local-engine-select-text';

        const chevron = document.createElement('span');
        chevron.className = 'local-engine-select-chevron';
        chevron.innerHTML = '&#9662;';

        const menu = document.createElement('div');
        menu.className = 'local-engine-select-menu';
        overlayHost.appendChild(menu);

        const updateMenuPosition = () => {
            const rect = trigger.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const estimatedHeight = Math.min(
                Math.max((options.options?.length ?? 0) * 46 + 12, 120),
                320,
            );
            const spaceBelow = viewportHeight - rect.bottom - 12;
            const spaceAbove = rect.top - 12;
            const openUpward = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

            menu.style.left = `${rect.left}px`;
            menu.style.width = `${rect.width}px`;
            menu.style.maxHeight = `${Math.max(
                140,
                Math.min(openUpward ? spaceAbove : spaceBelow, 320),
            )}px`;
            menu.dataset['placement'] = openUpward ? 'top' : 'bottom';

            if (openUpward) {
                menu.style.top = `${Math.max(8, rect.top - Math.min(estimatedHeight, spaceAbove) - 6)}px`;
            } else {
                menu.style.top = `${rect.bottom + 6}px`;
            }
        };

        const closeMenu = () => {
            root.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
            menu.classList.remove('open');
        };

        const syncDisplay = () => {
            valueEl.textContent =
                hiddenInput.value === '' ? (options.options?.[0] ?? '') : hiddenInput.value;
            menu.querySelectorAll('.local-engine-select-option').forEach((node) => {
                if (node instanceof HTMLButtonElement) {
                    node.classList.toggle('selected', node.textContent === valueEl.textContent);
                }
            });
        };

        options.options?.forEach((option) => {
            const optionBtn = document.createElement('button');
            optionBtn.type = 'button';
            optionBtn.className = 'local-engine-select-option';
            optionBtn.textContent = option;
            optionBtn.addEventListener(
                'click',
                () => {
                    hiddenInput.value = option;
                    syncDisplay();
                    closeMenu();
                    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                },
                { signal },
            );
            menu.appendChild(optionBtn);
        });

        trigger.append(valueEl, chevron);
        trigger.setAttribute('aria-expanded', 'false');

        trigger.addEventListener(
            'click',
            () => {
                const willOpen = !root.classList.contains('open');
                document.querySelectorAll('.local-engine-select.open').forEach((element) => {
                    element.classList.remove('open');
                    const button = element.querySelector('.local-engine-select-trigger');
                    if (button instanceof HTMLElement) {
                        button.setAttribute('aria-expanded', 'false');
                    }
                });
                document.querySelectorAll('.local-engine-select-menu.open').forEach((element) => {
                    element.classList.remove('open');
                });

                if (willOpen) {
                    updateMenuPosition();
                    root.classList.add('open');
                    trigger.setAttribute('aria-expanded', 'true');
                    menu.classList.add('open');
                    return;
                }

                closeMenu();
            },
            { signal },
        );

        document.addEventListener(
            'click',
            (event) => {
                if (!root.contains(event.target as Node) && !menu.contains(event.target as Node)) {
                    closeMenu();
                }
            },
            { signal },
        );

        window.addEventListener(
            'resize',
            () => {
                if (root.classList.contains('open')) {
                    updateMenuPosition();
                }
            },
            { signal },
        );

        window.addEventListener(
            'scroll',
            () => {
                if (root.classList.contains('open')) {
                    updateMenuPosition();
                }
            },
            { capture: true, signal },
        );

        root.append(hiddenInput, trigger);

        return {
            input: hiddenInput,
            root,
            syncDisplay,
            destroy: () => {
                controller.abort();
                closeMenu();
                menu.remove();
            },
        };
    }

    private _createTextAreaField(options: { placeholder?: string }): HTMLTextAreaElement {
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
        if (valueDesc?.set) {
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

        requestAnimationFrame(autoResize);
        return textArea;
    }

    private _createTextInputField(options: {
        type: string;
        placeholder?: string;
        min?: number;
        max?: number;
    }): HTMLInputElement {
        const textInput = document.createElement('input');
        textInput.type = options.type;
        textInput.className = 'settings-input local-engine-input';
        if (options.type === 'number') {
            textInput.inputMode = 'numeric';
        }
        if (options.placeholder !== undefined && options.placeholder !== '') {
            textInput.placeholder = options.placeholder;
        }
        if (options.min !== undefined) textInput.min = String(options.min);
        if (options.max !== undefined) textInput.max = String(options.max);
        return textInput;
    }

    private _setupEngineFieldInitialValue(
        input: EngineInputElement,
        options: {
            key: string;
            isEngineConfig: boolean;
            defaultValue?: number | string;
            config: EngineConfig | null;
        },
    ): void {
        if (options.isEngineConfig) {
            this._setInitialEngineConfigValue(input, options);
            return;
        }

        this._setInitialEngineSettingsValue(input, options);
    }

    private _setInitialEngineConfigValue(
        input: EngineInputElement,
        options: { key: string; config: EngineConfig | null },
    ): void {
        if (options.config === null) return;
        const configObj = options.config as unknown as Record<
            string,
            string | number | string[] | undefined
        >;
        let val = configObj[options.key];
        if (val !== undefined) {
            if (options.key === 'extra_args' && Array.isArray(val)) {
                val = val.join(' ');
            }
            const strVal = String(val);
            input.value = strVal;
            input.title = strVal;
        }
    }

    private _setInitialEngineSettingsValue(
        input: EngineInputElement,
        options: { key: string; defaultValue?: number | string },
    ): void {
        const savedSettings = this._deps.service.getSettings() as Record<
            string,
            string | number | undefined
        >;
        const val =
            savedSettings[options.key] ?? this._getLegacySettingsAliasValue(savedSettings, options.key);
        if (val !== undefined) {
            input.value = String(val);
            return;
        }

        if (options.defaultValue !== undefined) {
            input.value = String(options.defaultValue);
        }
    }

    private _getLegacySettingsAliasValue(
        savedSettings: Record<string, string | number | undefined>,
        key: string,
    ): string | number | undefined {
        if (key.endsWith('_positive_prompt')) {
            const legacyCamel = key.replace('_positive_prompt', '_positivePrompt');
            const legacyFlat = key.replace('_positive_prompt', '_positiveprompt');
            return savedSettings[legacyCamel] ?? savedSettings[legacyFlat];
        }
        if (key.endsWith('_negative_prompt')) {
            const legacyCamel = key.replace('_negative_prompt', '_negativePrompt');
            const legacyFlat = key.replace('_negative_prompt', '_negativeprompt');
            return savedSettings[legacyCamel] ?? savedSettings[legacyFlat];
        }
        return undefined;
    }

    private _parseEngineFieldValue(
        raw: string,
        options: {
            type: EngineFieldType;
            min?: number;
            max?: number;
            defaultValue?: number | string;
        },
    ): { value: string | number | null; displayValue: string } {
        if (options.type === 'number') {
            return this._parseNumberFieldValue(raw, options);
        }
        if (options.type === 'select') {
            return this._parseSelectFieldValue(raw, options);
        }
        return { value: raw === '' ? null : raw, displayValue: raw };
    }

    private _parseNumberFieldValue(
        raw: string,
        options: { min?: number; max?: number; defaultValue?: number | string },
    ): { value: number | null; displayValue: string } {
        if (raw === '') {
            return { value: null, displayValue: '' };
        }
        let num = Number(raw);
        if (Number.isNaN(num)) {
            const defVal = options.defaultValue as number | undefined;
            return {
                value: defVal ?? null,
                displayValue: defVal === undefined ? '' : String(defVal),
            };
        }
        if (options.min !== undefined && num < options.min) num = options.min;
        if (options.max !== undefined && num > options.max) num = options.max;
        return { value: num, displayValue: String(num) };
    }

    private _parseSelectFieldValue(
        raw: string,
        options: { defaultValue?: number | string },
    ): { value: string | null; displayValue: string } {
        if (raw === '') {
            const defVal = options.defaultValue as string | undefined;
            return {
                value: defVal ?? null,
                displayValue: defVal === undefined ? '' : String(defVal),
            };
        }
        return { value: raw, displayValue: raw };
    }

    private _setupEngineFieldEvents(
        input: EngineInputElement,
        options: {
            key: string;
            type: EngineFieldType;
            isEngineConfig: boolean;
            isFile?: boolean;
            config: EngineConfig | null;
            min?: number;
            max?: number;
            defaultValue?: number | string;
            appId: string;
        },
    ): void {
        input.addEventListener('focus', () => {
            input.parentElement?.classList.add('focused');
        });

        input.addEventListener('blur', () => {
            input.parentElement?.classList.remove('focused');
        });

        const handleSave = () => this._handleEngineFieldSave(input, options);

        if (
            options.type === 'text' ||
            options.type === 'number' ||
            options.type === 'password' ||
            options.type === 'textarea'
        ) {
            input.addEventListener('input', handleSave);
        }

        input.addEventListener('change', () => {
            const { displayValue } = this._parseEngineFieldValue(input.value.trim(), options);
            input.value = displayValue;
            handleSave();
        });
    }

    private _handleEngineFieldSave(
        input: EngineInputElement,
        options: {
            key: string;
            type: EngineFieldType;
            isEngineConfig: boolean;
            isFile?: boolean;
            config: EngineConfig | null;
            min?: number;
            max?: number;
            defaultValue?: number | string;
            appId: string;
        },
    ): void {
        let rawValue = input.value.trim();
        if (options.isFile === true && input instanceof HTMLInputElement) {
            rawValue = input.dataset['fullPath']?.trim() ?? rawValue;
        }
        const { value } = this._parseEngineFieldValue(rawValue, options);

        if (!options.isEngineConfig) {
            this._deps.debouncedSave(options.key, value as string | number | boolean | null);
            return;
        }

        if (options.config !== null) {
            (
                options.config as unknown as Record<string, string | number | string[] | null>
            )[options.key] = this._formatEngineFieldSaveValue(options.key, value);
            void this._deps.engineConfigService.setConfig(options.config);
            this._deps.showSaveIndicator();
        }
    }

    private _formatEngineFieldSaveValue(
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

    private _addFileBrowseButton(
        container: HTMLElement,
        input: HTMLInputElement,
        isImage: boolean,
    ): void {
        const browseBtn = document.createElement('button');
        browseBtn.className = 'btn btn-secondary local-engine-browse-btn';
        browseBtn.textContent = this._context.t('ui.settings.engine.browse', 'Browse');

        browseBtn.onclick = async () => {
            try {
                const selected = await open({
                    multiple: false,
                    filters: this._getModelFileFilters(isImage),
                    title: this._context.t(
                        'ui.settings.engine.select_model_file',
                        'Select Model File',
                    ),
                });

                if (selected !== null && !Array.isArray(selected)) {
                    input.dataset['fullPath'] = selected;
                    input.value = this._getModelFileName(selected);
                    input.title = selected;
                    input.dispatchEvent(new Event('change'));
                }
            } catch (error: unknown) {
                tracer.error('[ModuleSettingsUI] Failed to open file dialog', error);
            }
        };

        container.appendChild(browseBtn);
    }

    private _getModelFileFilters(
        isImage: boolean,
    ): Array<{ name: string; extensions: string[] }> {
        if (isImage) {
            return [
                { name: 'SD Models', extensions: ['gguf', 'safetensors'] },
                { name: 'GGUF Models', extensions: ['gguf'] },
                { name: 'SafeTensors', extensions: ['safetensors'] },
            ];
        }

        return [{ name: 'GGUF Models', extensions: ['gguf'] }];
    }
}
