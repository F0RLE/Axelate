/**
 * @module settings/ui/SettingsUI
 * @description Centralized UI management for the settings application, including dynamic module configuration and rendering.
 *
 * @example
 * ```typescript
 * const settingsUI = new SettingsUI(settingsService, stateService);
 * settingsUI.init();
 * ```
 */

import DOMPurify from 'dompurify';
import { type IGlobalBridge } from '@/shared/types/global_bridge_types';

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
import { getGlobalWin } from '@/shared/utils/globalAccessor';
import { eventBus } from '@/shared/services/EventBus';
import { aiSettingsRenderer } from '@/features/ai/ui/AISettingsRenderer';
import { tracer } from '@/infrastructure/logging/LoggerService';
import { type SettingsService } from '../services/SettingsService';
import { type UISettingsService } from '@/shared/services/ui/UISettingsService';
import { type AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { IApp, IConfigField } from '@/shared/types/coreTypes';
import { GeneralSettingsRenderer } from './GeneralSettingsRenderer';
import type { ISettingsUIContext } from './SettingsContext';
import { createField } from './components/FieldFactory';
import { CardResizer } from './components/CardResizer';
import { type I18nUI } from '@/infrastructure/i18n/I18nUI';
import { type TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import { type NavigationService } from '@/infrastructure/navigation/NavigationService';
import { EngineConfigService, type EngineConfig } from '@/features/ai/services/EngineConfigService';

type SettingValue = string | number | boolean | null;
export class SettingsUI {
    private readonly _unsubscribers: (() => void)[] = [];
    private _context!: ISettingsUIContext;
    private _resizer: CardResizer | null = null;
    private readonly _generalRenderer: GeneralSettingsRenderer;
    private readonly _engineConfigService: EngineConfigService;
    private readonly _saveTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private readonly _extraArgsControls = new Map<string, ExtraArgsControl>();
    private readonly _moduleCleanupHandlers: Array<() => void> = [];
    private _activeEngineInfoPopover: HTMLDivElement | null = null;
    private _activeEngineInfoCleanup: (() => void) | null = null;
    private readonly _boundLangChanged = () => {
        this.refreshActiveModule();
    };
    private readonly _boundDropdownDocumentClick = (event: MouseEvent) => {
        document.querySelectorAll('.lang-dropdown-menu').forEach((dropdown) => {
            const page = dropdown.id.replace('lang-dropdown-menu-', '');
            const btn = document.getElementById(`lang-dropdown-btn-${page}`);
            if (
                btn !== null &&
                !dropdown.contains(event.target as Node) &&
                !btn.contains(event.target as Node)
            ) {
                dropdown.classList.remove('show');
            }
        });
    };
    private _isInitialized = false;
    private _isDestroyed = false;

    private _renderSettingField(
        form: HTMLElement,
        appId: string,
        key: string,
        field: IConfigField,
    ): void {
        const row = document.createElement('div');
        row.className = 'form-row';

        const label = document.createElement('label');
        label.textContent = field.label || key;
        row.appendChild(label);

        const settingKey = `${appId}_${key}`;
        // Safe cast to access dictionary
        const savedSettings = this._service.getSettings() as unknown as Record<
            string,
            SettingValue
        >;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const initialValue = savedSettings[settingKey] ?? field.default;

        const fieldComponent = createField(field, initialValue);

        fieldComponent.onChange((val: unknown) => {
            // Cast val to SettingValue (string|number|boolean|null)
            const value = val as SettingValue;
            this._debouncedSave(settingKey, value);
        });

        row.appendChild(fieldComponent.render());
        form.appendChild(row);
    }

    constructor(
        private readonly _service: SettingsService,
        private readonly _uiSettings: UISettingsService,
        private readonly _aiSettings: AISettingsService,
        private readonly _i18nUI: I18nUI,
        private readonly _tauri: TauriProvider,
        private readonly _navigation: NavigationService,
    ) {
        this._generalRenderer = new GeneralSettingsRenderer(_uiSettings);
        this._engineConfigService = new EngineConfigService(_tauri);
    }
    /**
     * Initializes the settings UI, renders components, and binds events.
     */
    public async init(): Promise<void> {
        if (this._isInitialized || this._isDestroyed) return;
        this._isInitialized = true;

        await aiSettingsRenderer.init(this._service, this._aiSettings, this._tauri);

        // 1. Setup Context
        const win = getGlobalWin();
        this._context = {
            t: win.t ?? ((_: string, d?: string) => d ?? ''),
            showToast:
                win.showToast ??
                ((m: string, s: string) => {
                    tracer.info(m, s);
                }),
            toggleNavItem: (id: string, en: boolean) => {
                this._generalRenderer.toggleNavItem(id, en);
            },
            toggleMonitorItem: (id: string, en: boolean) => {
                this._generalRenderer.toggleMonitorItem(id, en);
            },
            i18nUI: this._i18nUI,
        };

        // Wait for settings template to be injected
        let attempts = 0;
        let container = document.getElementById('settings-grid');
        while (container === null && attempts < 50) {
            await new Promise((r) => setTimeout(r, 100));
            container = document.getElementById('settings-grid');
            attempts++;
        }

        if (container === null) {
            tracer.error(
                '[SettingsUI] Settings container "settings-grid" not found after 5s. Rendering failed.',
            );
        } else {
            tracer.info('[SettingsUI] Settings container found. Initializing renderers.');
        }

        // 0. Subscribe to navigation events
        const unsub = eventBus.on('page:change', () => {
            this.close();
        });
        this._unsubscribers.push(unsub);

        // 1. Load Data
        this._generalRenderer.init(this._context);
        this._loadCardWidths();
        this._bindEvents();

        this._resizer = new CardResizer((id: string, w: string) => {
            this._uiSettings.setCardWidth(id, w);
        });
        this._resizer.init();

        // 5. Expose necessary global functions (legacy support for some templates)
        win.openModuleSettings = (app: IApp) => {
            void this._openModuleSettingsHelper(app).catch((e: unknown) => {
                tracer.error(String(e));
            });
        };
        (win as unknown as IGlobalBridge)['setCardWidth'] = (btn: HTMLElement, w: string) => {
            this.setCardWidth(btn, w);
        };

        globalThis.addEventListener('lang:changed', this._boundLangChanged);
    }

    public close(): void {
        this._resetDynamicModuleState();
        delete this._context.currentModule;
        this._navigation.removeBackAction('module-settings-modal');
        const modal = document.getElementById('module-settings-modal') as HTMLDialogElement | null;
        if (modal) {
            if (modal.open) {
                modal.close();
            }
            // Wait for transition if needed, or enforce immediately if logic dictates
            modal.classList.add('hidden');
        }

        // Restore UI visibility
        document.body.classList.remove('settings-modal-open');
        const sidebar = document.getElementById('sidebar');
        const header = document.getElementById('app-header');
        const modelsContainer = document.querySelector('.models-container');
        const pages = document.querySelectorAll('.page');

        if (sidebar) sidebar.classList.remove('content-hidden');
        if (header) header.classList.remove('content-hidden');
        if (modelsContainer) modelsContainer.classList.remove('content-hidden');
        pages.forEach((p) => p.classList.remove('content-hidden'));
    }

    /**
     * Re-renders the currently open settings module (e.g. on language change).
     */
    public refreshActiveModule(): void {
        const currentApp = this._context.currentModule;

        const modal = document.getElementById('module-settings-modal') as HTMLDialogElement | null;
        const container = document.getElementById('module-config-modal-active');

        if (modal && modal.open && container !== null && currentApp !== undefined) {
            tracer.debug('[SettingsUI] Refreshing active module settings:', currentApp.id);

            const title = document.getElementById('module-settings-title');
            const suffix = this._context.t('ui.settings.header_suffix', 'Settings');
            if (title !== null) title.innerHTML = DOMPurify.sanitize(suffix);

            this._renderSpecializedModuleConfig(container, currentApp).catch((e: unknown) => {
                tracer.error(String(e));
            });
        }
    }

    /**
     * Resets internal state and deactivates observers.
     * MANDATORY cleanup method required by Section 4.3.
     */
    public destroy(): void {
        if (this._isDestroyed) return;
        this._isDestroyed = true;
        this._isInitialized = false;

        this.close();
        this._unsubscribers.forEach((fn) => {
            fn();
        });
        this._unsubscribers.length = 0;
        document.removeEventListener('click', this._boundDropdownDocumentClick);
        globalThis.removeEventListener('lang:changed', this._boundLangChanged);
        this._saveTimeouts.forEach((timeoutId) => {
            clearTimeout(timeoutId);
        });
        this._saveTimeouts.clear();
        this._resizer?.destroy();
        this._resizer = null;
        aiSettingsRenderer.destroy();
        tracer.info('[SettingsUI] Destroyed.');
    }

    /**
     * Renders a specialized module configuration UI (API, Local AI, or generic).
     */
    private async _renderSpecializedModuleConfig(container: HTMLElement, app: IApp) {
        this._resetDynamicModuleState();

        const renderers: Record<string, (c: HTMLElement, a: IApp) => Promise<void> | void> = {
            gpt: (c, a) => {
                void this._renderUniversalApiSettings(c, a);
            },
            gemini: (c, a) => {
                void this._renderUniversalApiSettings(c, a);
            },
            claude: (c, a) => {
                void this._renderUniversalApiSettings(c, a);
            },
            deepseek: (c, a) => {
                void this._renderUniversalApiSettings(c, a);
            },
            axelate: (c, a) => {
                this._renderEmptyState(c, a);
            },
            'axelate-platform': (c, a) => {
                this._renderEmptyState(c, a);
            },
            'axelate-localai': (c, a) => {
                this._renderEmptyState(c, a);
            },
        };

        const renderer = renderers[app.id];
        if (renderer !== undefined) {
            await renderer(container, app);
            return;
        }

        // Local engine — render real config from backend
        if (app.type === 'local') {
            await this._renderLocalEngineConfig(container, app);
            return;
        }

        if (app.type === 'api') {
            await this._renderUniversalApiSettings(container, app);
            return;
        }

        if (app.id.includes('telegram')) {
            this._renderEmptyState(container, app);
            return;
        }

        // Default Schema-based rendering
        container.innerHTML = '';
        if (app.configSchema !== undefined && Object.keys(app.configSchema).length > 0) {
            const form = document.createElement('div');
            form.className = 'module-settings-form';

            const header = document.createElement('h3');
            header.style.marginBottom = '1.5rem';
            header.style.color = 'var(--text-primary)';
            header.textContent = app.name !== undefined && app.name !== '' ? app.name : app.id;
            form.appendChild(header);

            Object.entries(app.configSchema).forEach(([key, field]) => {
                this._renderSettingField(form, app.id, key, field);
            });
            container.appendChild(form);
        } else {
            this._renderEmptyState(container, app);
        }
    }

    /**
     * Renders a standardized empty state for modules with no settings.
     * "There is nothing there" - Minimalist visual standard.
     */
    private _renderEmptyState(container: HTMLElement, _app: IApp) {
        const t = this._context.t;

        container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'ai-module-config universal-api-theme';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.alignItems = 'center';
        wrapper.style.justifyContent = 'center';
        wrapper.style.width = '100%';
        wrapper.style.padding = '2rem 0';

        const textDiv = document.createElement('div');
        textDiv.style.textAlign = 'center';
        textDiv.style.color = 'var(--text-secondary)';
        textDiv.style.fontSize = '1.2rem';
        textDiv.style.opacity = '0.7';
        textDiv.dataset['i18n'] = 'ui.settings.module_not_ready';
        textDiv.textContent = t('ui.settings.module_not_ready', 'This module is not ready yet.');

        wrapper.appendChild(textDiv);
        container.appendChild(wrapper);
    }

    /**
     * Renders engine config form for local engines (llamacpp, sdcpp, etc.).
     * Loads the persisted EngineConfig from Tauri, renders fields, saves on change.
     */
    private async _renderLocalEngineConfig(container: HTMLElement, app: IApp): Promise<void> {
        const t = this._context.t;
        container.innerHTML = '';

        const config = await this._engineConfigService.getConfig(app.id);
        const isImage = app.capability === 'image';
        const modelExt = isImage ? '.safetensors' : '.gguf';
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
        this._renderEngineFieldRow(corePrimary, {
            label: t('ui.settings.engine.model_path', 'Model Path (*.gguf, *.safetensors)'),
            key: 'model_path',
            type: 'text',
            isEngineConfig: true,
            placeholder: String.raw`e.g. C:\Models\model` + modelExt,
            isFile: true,
            isImage,
            fullWidth: true,
            appId: app.id,
            config,
        });

        if (isImage) {
            this._renderPerformanceModeToggle(corePrimary, app.id);

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
                fullWidth: true,
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
                fullWidth: true,
                appId: app.id,
                config,
            });
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
                label: t('ui.settings.engine.sd_cfg', 'Guidance'),
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
        } else {
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
        const normalized = modelPath.replace(/\\/g, '/');
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
                                <div id="local-engine-prompts-${app.id}" class="local-engine-field-stack"></div>
                            </div>
                            <div class="local-engine-control-grid">
                                <div class="local-engine-panel-card local-engine-panel-card--compact">
                                    <div class="local-engine-group-header">
                                        <h4>${this._escapeHtml(
                                            t('ui.settings.engine.group_size', 'Image Size'),
                                        )}</h4>
                                    </div>
                                    <div id="local-engine-size-${app.id}" class="local-engine-field-grid"></div>
                                </div>
                                <div class="local-engine-panel-card local-engine-panel-card--compact">
                                    <div class="local-engine-group-header">
                                        <h4>${this._escapeHtml(
                                            t('ui.settings.engine.group_sampling', 'Sampling'),
                                        )}</h4>
                                    </div>
                                    <div id="local-engine-sampling-${app.id}" class="local-engine-field-grid"></div>
                                </div>
                                <div class="local-engine-panel-card local-engine-panel-card--compact">
                                    <div class="local-engine-group-header">
                                        <h4>${this._escapeHtml(
                                            t('ui.settings.engine.group_batch', 'Batch & Seed'),
                                        )}</h4>
                                    </div>
                                    <div id="local-engine-batch-${app.id}" class="local-engine-field-grid"></div>
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
                            <div class="local-engine-form-grid local-engine-form-grid--single">
                                <div class="local-engine-panel-card local-engine-panel-card--hero local-engine-panel-card--flat">
                                    <div class="local-engine-spotlight"></div>
                                    <div id="local-engine-core-primary-${app.id}" class="local-engine-field-stack local-engine-field-stack--tight"></div>
                                </div>
                            </div>
                            ${warnHtml}
                        </div>
                    </section>
                    ${generationSection}
                </div>
            </div>
        `;
    }

    // eslint-disable-next-line @typescript-eslint/max-params
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

        const lbl = document.createElement('label');
        lbl.textContent = options.label;
        lbl.className = 'local-engine-field-label';
        labelRow.appendChild(lbl);

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'local-engine-input-row';

        let input: HTMLElement;
        let engineInput: EngineInputElement;
        let customSelect: CustomSelectControl | null = null;
        let extraArgsControl: ExtraArgsControl | null = null;

        if (options.type === 'select') {
            customSelect = this._createCustomSelectField(options);
            input = customSelect.root;
            engineInput = customSelect.input;
        } else if (options.isEngineConfig && options.key === 'extra_args') {
            extraArgsControl = this._createExtraArgsField(options);
            input = extraArgsControl.root;
            engineInput = extraArgsControl.input;
            this._extraArgsControls.set(options.appId, extraArgsControl);
        } else if (options.type === 'textarea') {
            input = this._createTextAreaField(options);
            engineInput = input as HTMLTextAreaElement;
        } else {
            input = this._createTextInputField(options);
            engineInput = input as HTMLInputElement;
        }

        this._setupEngineFieldInitialValue(engineInput, options);
        this._setupEngineFieldEvents(engineInput, options);
        customSelect?.syncDisplay();
        if (customSelect !== null) {
            this._registerModuleCleanup(() => {
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

        if (options.isFile === true && this._tauri.isTauri()) {
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
            infoBtn.textContent = 'i';
            infoBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this._toggleEngineInfoPopover(infoBtn, options.appId);
            });
            inputWrapper.appendChild(infoBtn);
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

    private _renderPerformanceModeToggle(container: HTMLElement, appId: string): void {
        const row = document.createElement('div');
        row.className = 'local-engine-field-row full-width';

        const labelRow = document.createElement('div');
        labelRow.className = 'local-engine-label-row';

        const lbl = document.createElement('label');
        lbl.textContent = this._context.t(
            'ui.settings.engine.performance_mode',
            'Performance Mode',
        );
        lbl.className = 'local-engine-field-label';
        labelRow.appendChild(lbl);

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'local-engine-input-row';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'local-engine-performance-toggle';

        const title = document.createElement('span');
        title.className = 'local-engine-performance-toggle-title';
        title.textContent = this._context.t(
            'ui.settings.engine.performance_mode_title',
            'Close launcher during generation',
        );

        const status = document.createElement('span');
        status.className = 'local-engine-performance-toggle-status';

        const updateState = (enabled: boolean) => {
            toggle.classList.toggle('active', enabled);
            toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            status.textContent = enabled
                ? this._context.t('ui.common.enabled', 'Enabled')
                : this._context.t('ui.common.disabled', 'Disabled');
        };

        const settings = this._service.getSettings() as Record<
            string,
            string | boolean | undefined
        >;
        let enabled =
            String(settings[`${appId}_performance_mode`] ?? 'false').toLowerCase() === 'true';
        updateState(enabled);

        toggle.append(title, status);
        toggle.addEventListener('click', () => {
            enabled = !enabled;
            updateState(enabled);
            this._debouncedSave(`${appId}_performance_mode`, enabled);
        });

        inputWrapper.appendChild(toggle);
        row.append(labelRow, inputWrapper);
        container.appendChild(row);
    }

    private _createExtraArgsField(_options: {
        placeholder?: string;
        defaultValue?: number | string;
    }): ExtraArgsControl {
        const root = document.createElement('div');
        root.className = 'local-engine-tags-editor';

        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.className = 'local-engine-tags-value';

        const chips = document.createElement('div');
        chips.className = 'local-engine-tags-chips';

        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.className = 'local-engine-tags-input';
        textInput.placeholder = this._context.t(
            'ui.settings.engine.extra_args.placeholder',
            'Add flag and press Enter',
        );

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

        const setGroups = (groups: string[]) => {
            hiddenInput.value = flattenGroups(groups);
            syncTokens();
            hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        };

        const commitInputValue = () => {
            const nextGroups = parseGroups(textInput.value);
            if (nextGroups.length === 0) return;
            setGroups([...getGroups(), ...nextGroups]);
            textInput.value = '';
        };

        const syncTokens = () => {
            chips.innerHTML = '';
            const groups = getGroups();

            groups.forEach((group, index) => {
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

        textInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                commitInputValue();
                return;
            }

            if (event.key === 'Backspace' && textInput.value === '') {
                const groups = getGroups();
                if (groups.length > 0) {
                    event.preventDefault();
                    setGroups(groups.slice(0, -1));
                }
            }
        });

        textInput.addEventListener('blur', () => {
            commitInputValue();
        });

        root.append(chips, textInput, hiddenInput);

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
            const currentAppId = this._activeEngineInfoPopover.dataset['appId'];
            if (currentAppId === appId) {
                this._closeEngineInfoPopover();
                return;
            }
            this._closeEngineInfoPopover();
        }

        this._openEngineInfoPopover(anchor, appId);
    }

    private _openEngineInfoPopover(anchor: HTMLButtonElement, appId: string): void {
        const modal =
            (document.getElementById('module-settings-modal') as HTMLDialogElement | null) ??
            document.body;
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

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'local-engine-args-copy-btn';
            copyBtn.textContent = this._context.t('ui.launcher.web.copy', 'Copy');
            copyBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                await this._copyTextToClipboard(item.flag);
                this._context.showToast(
                    this._context
                        .t('ui.settings.engine.extra_args.flag_copied', '{flag} copied')
                        .replace('{flag}', item.flag),
                    'success',
                );
            });

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

            row.append(meta, copyBtn);
            list.appendChild(row);
        });

        popover.append(title, subtitle, actions, list);
        modal.appendChild(popover);

        const updatePosition = () => {
            const rect = anchor.getBoundingClientRect();
            const popRect = popover.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const desiredWidth = Math.min(420, viewportWidth - 32);
            const left = Math.min(
                viewportWidth - desiredWidth - 16,
                Math.max(16, rect.right - desiredWidth),
            );
            const openUpward =
                rect.bottom + popRect.height + 16 > viewportHeight && rect.top > popRect.height;
            const top = openUpward
                ? Math.max(16, rect.top - popRect.height - 10)
                : Math.min(viewportHeight - popRect.height - 16, rect.bottom + 10);

            popover.style.width = `${desiredWidth}px`;
            popover.style.left = `${left}px`;
            popover.style.top = `${top}px`;
            popover.dataset['placement'] = openUpward ? 'top' : 'bottom';
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

        requestAnimationFrame(updatePosition);
    }

    private _closeEngineInfoPopover(): void {
        this._activeEngineInfoCleanup?.();
        this._activeEngineInfoCleanup = null;
        this._activeEngineInfoPopover?.remove();
        this._activeEngineInfoPopover = null;
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
                        flag: '--threads 8',
                        description: 'Set an explicit CPU thread count for generation.',
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
                'These are appended to llama-server startup. Port, context window and GPU layers are already managed by the launcher UI.',
            items: [
                { flag: '--flash-attn', description: 'Enable flash attention if supported.' },
                { flag: '--threads 8', description: 'Set explicit CPU thread count.' },
                { flag: '--parallel 1', description: 'Limit parallel slots for stability.' },
                { flag: '--mlock', description: 'Keep model memory pinned in RAM.' },
                { flag: '--no-mmap', description: 'Disable mmap if storage causes issues.' },
            ],
        };
    }

    private async _copyTextToClipboard(text: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const helper = document.createElement('textarea');
            helper.value = text;
            helper.setAttribute('readonly', 'true');
            helper.style.position = 'fixed';
            helper.style.opacity = '0';
            document.body.appendChild(helper);
            helper.select();
            document.execCommand('copy');
            helper.remove();
        }
    }

    private _createCustomSelectField(options: { options?: string[] }): CustomSelectControl {
        const root = document.createElement('div');
        root.className = 'local-engine-select';
        const overlayHost =
            (document.getElementById('module-settings-modal') as HTMLElement | null) ??
            document.body;
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
                hiddenInput.value !== '' ? hiddenInput.value : (options.options?.[0] ?? '');
            menu.querySelectorAll('.local-engine-select-option').forEach((node) => {
                if (node instanceof HTMLButtonElement) {
                    node.classList.toggle('selected', node.textContent === valueEl.textContent);
                }
            });
        };

        options.options?.forEach((opt) => {
            const optionBtn = document.createElement('button');
            optionBtn.type = 'button';
            optionBtn.className = 'local-engine-select-option';
            optionBtn.textContent = opt;
            optionBtn.addEventListener(
                'click',
                () => {
                    hiddenInput.value = opt;
                    syncDisplay();
                    closeMenu();
                    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                },
                { signal },
            );
            menu.appendChild(optionBtn);
        });

        trigger.appendChild(valueEl);
        trigger.appendChild(chevron);
        trigger.setAttribute('aria-expanded', 'false');

        trigger.addEventListener(
            'click',
            () => {
                const willOpen = !root.classList.contains('open');
                document.querySelectorAll('.local-engine-select.open').forEach((el) => {
                    el.classList.remove('open');
                    const btn = el.querySelector('.local-engine-select-trigger');
                    if (btn instanceof HTMLElement) {
                        btn.setAttribute('aria-expanded', 'false');
                    }
                });
                document.querySelectorAll('.local-engine-select-menu.open').forEach((el) => {
                    el.classList.remove('open');
                });

                if (willOpen) {
                    updateMenuPosition();
                    root.classList.add('open');
                    trigger.setAttribute('aria-expanded', 'true');
                    menu.classList.add('open');
                } else {
                    closeMenu();
                }
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

        root.appendChild(hiddenInput);
        root.appendChild(trigger);

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
            if (options.config !== null) {
                const configObj = options.config as unknown as Record<
                    string,
                    string | number | string[] | undefined
                >;
                let val = configObj[options.key];
                if (val !== undefined) {
                    if (options.key === 'extra_args' && Array.isArray(val)) {
                        val = val.join(' ');
                    }
                    input.value = String(val);
                    if ('title' in input) {
                        input.title = String(val);
                    }
                }
            }
        } else {
            const savedSettings = this._service.getSettings() as unknown as Record<
                string,
                string | number | undefined
            >;
            const val =
                savedSettings[options.key] ??
                this._getLegacySettingsAliasValue(savedSettings, options.key);
            if (val !== undefined) {
                input.value = String(val);
            } else if (options.defaultValue !== undefined) {
                input.value = String(options.defaultValue);
            }
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
        const finalVal = raw === '' ? null : raw;
        return { value: finalVal, displayValue: raw };
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
            input.style.borderColor = 'rgba(255,255,255,0.16)';
            input.style.boxShadow = '0 0 0 3px rgba(255,255,255,0.045)';
            input.style.background = 'rgba(255,255,255,0.045)';
        });

        input.addEventListener('blur', () => {
            input.style.borderColor = 'var(--border-color)';
            input.style.boxShadow = 'none';
            input.style.background = 'rgba(0,0,0,0.18)';
        });

        const handleSave = () => this._handleEngineFieldSave(input, options);

        // Use 'input' for text/number/textarea fields to get real-time autosave
        if (
            options.type === 'text' ||
            options.type === 'number' ||
            options.type === 'password' ||
            options.type === 'textarea'
        ) {
            input.addEventListener('input', handleSave);
        }

        // Always keep 'change' as a reliable final synchronization (and for 'select')
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

        if (options.isEngineConfig) {
            if (options.config !== null) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (options.config as any)[options.key] = this._formatEngineFieldSaveValue(
                    options.key,
                    value,
                );
                void this._engineConfigService.setConfig(options.config);
                this._showSaveIndicator();
            }
        } else {
            this._debouncedSave(options.key, value as string | number | boolean | null);
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
                const { open } = await import('@tauri-apps/plugin-dialog');
                const extName = isImage ? 'SafeTensors' : 'GGUF Models';
                const extFilter = isImage ? 'safetensors' : 'gguf';

                const selected = await open({
                    multiple: false,
                    filters: [{ name: extName, extensions: [extFilter] }],
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
            } catch (e) {
                tracer.error('[SettingsUI] Failed to open file dialog', e);
            }
        };

        container.appendChild(browseBtn);
    }

    /** Renders universal API settings using the AIRenderer. */
    private async _renderUniversalApiSettings(container: HTMLElement, app: IApp): Promise<void> {
        // Delegate to dedicated AI Settings Renderer singleton (Section 16.1)
        await aiSettingsRenderer.render(container, app);
    }

    // --- Card Resizing ---

    private _loadCardWidths() {
        const widths = this._uiSettings.getCardWidths();
        Object.keys(widths).forEach((id) => {
            const card = document.querySelector(`.resizable-card[data-card-id="${id}"]`);
            const width = widths[id];
            if (card instanceof HTMLElement && typeof width === 'string') {
                card.dataset['cardWidth'] = width;
                this._updateCardLayout(card, width);
            }
        });
    }

    private setCardWidth(btn: HTMLElement, width: string) {
        const card = btn.closest('.hardware-card');
        if (!(card instanceof HTMLElement)) return;

        card.dataset['cardWidth'] = width;
        const id = card.dataset['cardId'];
        if (id !== undefined) this._uiSettings.setCardWidth(id, width);

        const buttons = card.querySelectorAll<HTMLElement>('.btn');
        buttons.forEach((b) => {
            if (b === btn) {
                b.style.background = 'var(--primary)';
                b.style.color = 'white';
            } else {
                b.style.background = 'var(--bg-light)';
                b.style.color = 'var(--text-secondary)';
            }
        });

        this._updateCardLayout(card, width);
    }

    private _updateCardLayout(card: HTMLElement, width: string) {
        const container = card.closest('[style*="grid-template-columns"]');
        if (container instanceof HTMLElement) {
            if (width === 'full') {
                container.style.gridTemplateColumns = '1fr';
            } else {
                container.style.gridTemplateColumns = '1fr 1fr';
            }
        }
    }

    // Card Resizing delegated to CardResizer component

    // --- Auto Save ---

    /**
     * Binds global events (e.g. clicking outside dropdowns).
     */
    private _bindEvents() {
        document.addEventListener('click', this._boundDropdownDocumentClick);
    }

    private _registerModuleCleanup(cleanup: () => void): void {
        this._moduleCleanupHandlers.push(cleanup);
    }

    private _resetDynamicModuleState(): void {
        this._closeEngineInfoPopover();
        this._extraArgsControls.clear();

        while (this._moduleCleanupHandlers.length > 0) {
            const cleanup = this._moduleCleanupHandlers.pop();
            cleanup?.();
        }
    }

    /**
     * Helper to open the settings modal for a specific module.
     */
    private async _openModuleSettingsHelper(app: IApp) {
        const modal = document.getElementById('module-settings-modal') as HTMLDialogElement | null;
        const container = document.getElementById('module-config-modal-active');
        const title = document.getElementById('module-settings-title');

        if (modal === null || container === null || title === null) return;

        this._context.currentModule = app;

        const suffix = this._context.t('ui.settings.header_suffix', 'Settings');
        title.innerHTML = DOMPurify.sanitize(suffix);

        await this._renderSpecializedModuleConfig(container, app);
        this._context.i18nUI.applyTranslations(container);

        // modal-backdrop: just remove hidden class, CSS handles animation
        modal.classList.remove('hidden');
        this._navigation.pushBackAction(
            'module-settings-modal',
            () => {
                this.close();
            },
            () => {
                const win = getGlobalWin();
                if (typeof win.openModuleSettings === 'function') {
                    win.openModuleSettings(app);
                }
            },
        );
        modal.showModal();

        // Single window requirement: Hide all background UI elements
        const win = getGlobalWin();
        if (typeof win.closeAppSelection === 'function') {
            win.closeAppSelection();
        }

        document.body.classList.add('settings-modal-open');
        const sidebar = document.getElementById('sidebar');
        const header = document.getElementById('app-header');
        const pages = document.querySelectorAll('.page');
        const modelsContainer = document.querySelector('.models-container');

        if (sidebar) sidebar.classList.add('content-hidden');
        if (header) header.classList.add('content-hidden');
        if (modelsContainer) modelsContainer.classList.add('content-hidden');
        pages.forEach((p) => p.classList.add('content-hidden'));

        // Close logic
        const closeBtn = document.getElementById('close-module-settings-btn');
        if (closeBtn) {
            closeBtn.onclick = () => {
                this.close();
            };
        }

        // Close on overlay click
        modal.onclick = (e) => {
            if (
                e.target === modal ||
                (e.target as HTMLElement).classList.contains('modal-backdrop')
            ) {
                this.close();
            }
        };
    }

    /**
     * Shows a transient save confirmation message.
     */
    private _showSaveIndicator() {
        const el = document.getElementById('save-indicator');
        if (el) {
            el.classList.add('show');
            const span = el.querySelector('span');
            if (span) {
                span.style.color = 'var(--text-primary)';
                span.textContent = this._context.t('ui.settings.saved_message', 'Settings Saved');
            }
        }
    }

    /**
     * Hides the save indicator.
     */
    private _hideSaveIndicator() {
        const el = document.getElementById('save-indicator');
        if (el) el.classList.remove('show');
    }

    private _debouncedSave(key: string, value: string | number | boolean | null): void {
        const existingTimeout = this._saveTimeouts.get(key);
        if (existingTimeout) clearTimeout(existingTimeout);

        this._showSaveIndicator();
        const timeout = setTimeout(async () => {
            try {
                await this._service.saveSetting(key, String(value));
                this._saveTimeouts.delete(key);
                if (this._saveTimeouts.size === 0) {
                    this._hideSaveIndicator();
                }
            } catch (err) {
                tracer.error(`[SettingsUI] Failed to autosave setting ${key}:`, err);
                const indicator = document.getElementById('save-indicator');
                if (indicator) {
                    indicator.classList.add('show');
                    const span = indicator.querySelector('span');
                    if (span) {
                        span.style.color = 'var(--error)';
                        span.textContent = this._context.t(
                            'ui.settings.save_failed',
                            'Save failed',
                        );
                    }
                }
                this._saveTimeouts.delete(key);
            }
        }, 1000);

        this._saveTimeouts.set(key, timeout);
    }
}
