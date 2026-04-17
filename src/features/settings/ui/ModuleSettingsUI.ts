/**
 * @module settings/ui/ModuleSettingsUI
 * @description UI management for module settings modal rendering and engine/provider configuration.
 *
 * @example
 * ```typescript
 * const moduleSettingsUI = new ModuleSettingsUI(settingsService, stateService);
 * moduleSettingsUI.init();
 * ```
 */

import { getGlobalWin } from '@/shared/utils/globalAccessor';
import { eventBus } from '@/shared/services/EventBus';
import { aiSettingsRenderer } from '@/features/ai/ui/AISettingsRenderer';
import { tracer } from '@/infrastructure/logging/LoggerService';
import { type SettingsService } from '../services/SettingsService';
import { type UISettingsService } from '@/shared/services/ui/UISettingsService';
import { type AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { IApp, IConfigField } from '@/shared/types/coreTypes';
import type { IModuleSettingsUIContext } from './SettingsContext';
import { createField } from './components/FieldFactory';
import { CardResizer } from './components/CardResizer';
import { type I18nUI } from '@/infrastructure/i18n/I18nUI';
import { type TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import { type NavigationService } from '@/infrastructure/navigation/NavigationService';
import { EngineConfigService } from '@/features/ai/services/EngineConfigService';
import { ModuleSettingsModalController } from './ModuleSettingsModalController';
import { ModuleSettingsBridgeController } from './ModuleSettingsBridgeController';
import { ModuleSettingsAutosaveController } from './ModuleSettingsAutosaveController';
import { ModuleSettingsCustomUiController } from './ModuleSettingsCustomUiController';
import { ModuleSettingsEngineRenderer } from './ModuleSettingsEngineRenderer';

type SettingValue = string | number | boolean | null;
type EngineRendererCompat = {
    _extraArgsControls: Map<
        string,
        {
            input: HTMLInputElement;
            root: HTMLDivElement;
            syncTokens: () => void;
            getGroups: () => string[];
            setGroups: (groups: string[]) => void;
        }
    >;
    _escapeHtml: (value: string) => string;
    _getModelFileName: (path: string) => string;
    _getEngineConfigHtml: (
        app: IApp,
        config:
            | {
                  [key: string]: string | number | string[] | undefined;
              }
            | null,
    ) => string;
    _appendExtraArgs: (appId: string, groups: string[]) => number;
    _toggleEngineInfoPopover: (anchor: HTMLButtonElement, appId: string) => void;
    _closeEngineInfoPopover: () => void;
    _createTextAreaField: (options: { placeholder?: string }) => HTMLTextAreaElement;
    _createTextInputField: (options: {
        type: string;
        placeholder?: string;
        min?: number;
        max?: number;
    }) => HTMLInputElement;
    _setupEngineFieldInitialValue: (
        input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
        options: {
            key: string;
            isEngineConfig: boolean;
            defaultValue?: number | string;
            config:
                | {
                      [key: string]: string | number | string[] | undefined;
                  }
                | null;
        },
    ) => void;
    _parseEngineFieldValue: (
        raw: string,
        options: {
            type: 'number' | 'text' | 'select' | 'password' | 'textarea';
            min?: number;
            max?: number;
            defaultValue?: number | string;
        },
    ) => { value: string | number | null; displayValue: string };
    _formatEngineFieldSaveValue: (
        key: string,
        value: string | number | null,
    ) => string | number | string[] | null;
    _handleEngineFieldSave: (
        input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
        options: {
            key: string;
            type: 'number' | 'text' | 'select' | 'password' | 'textarea';
            isEngineConfig: boolean;
            isFile?: boolean;
            config:
                | {
                      [key: string]: string | number | string[] | undefined;
                  }
                | null;
            min?: number;
            max?: number;
            defaultValue?: number | string;
            appId: string;
        },
    ) => void;
    _createCustomSelectField: (options: { options?: string[] }) => {
        input: HTMLInputElement;
        root: HTMLDivElement;
        syncDisplay: () => void;
        destroy: () => void;
    };
    _createExtraArgsField: (options: { placeholder?: string; defaultValue?: number | string }) => {
        root: HTMLDivElement;
        input: HTMLInputElement;
        syncTokens: () => void;
        getGroups: () => string[];
        setGroups: (groups: string[]) => void;
    };
    _addFileBrowseButton: (
        container: HTMLElement,
        input: HTMLInputElement,
        isImage: boolean,
    ) => void;
    _renderEngineFieldRow: (
        container: HTMLElement,
        options: Record<string, unknown>,
    ) => void;
    _renderPerformanceModeFieldRow: (container: HTMLElement, appId: string) => void;
};

export class ModuleSettingsUI {
    private readonly _unsubscribers: (() => void)[] = [];
    private _context!: IModuleSettingsUIContext;
    private _resizer: CardResizer | null = null;
    private readonly _engineConfigService: EngineConfigService;
    private _engineRenderer: ModuleSettingsEngineRenderer | null = null;
    private readonly _modalController: ModuleSettingsModalController;
    private readonly _bridgeController = new ModuleSettingsBridgeController();
    private _autosaveController: ModuleSettingsAutosaveController | null = null;
    private _customUiController: ModuleSettingsCustomUiController | null = null;
    private readonly _moduleCleanupHandlers: Array<() => void> = [];
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

        if (
            field.description !== undefined &&
            field.description !== null &&
            field.description !== ''
        ) {
            const help = document.createElement('p');
            help.className = 'stats-note';
            help.textContent = field.description;
            row.appendChild(help);
        }

        form.appendChild(row);
    }

    private _getSortedConfigSchemaEntries(app: IApp): Array<[string, IConfigField]> {
        return Object.entries(app.configSchema ?? {}).sort((left, right) => {
            const leftOrder = left[1].order ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = right[1].order ?? Number.MAX_SAFE_INTEGER;
            if (leftOrder !== rightOrder) {
                return leftOrder - rightOrder;
            }

            const leftLabel = left[1].label || left[0];
            const rightLabel = right[1].label || right[0];
            return leftLabel.localeCompare(rightLabel);
        });
    }

    private _renderConfigSchemaFields(form: HTMLElement, app: IApp): void {
        let currentSection: string | null = null;

        this._getSortedConfigSchemaEntries(app).forEach(([key, field]) => {
            const nextSection = field.section?.trim() ?? '';
            if (nextSection !== '' && nextSection !== currentSection) {
                currentSection = nextSection;
                const sectionHeading = document.createElement('h4');
                sectionHeading.className = 'card-title';
                sectionHeading.style.margin = '1.5rem 0 0.75rem';
                sectionHeading.style.fontSize = '0.95rem';
                sectionHeading.textContent = currentSection;
                form.appendChild(sectionHeading);
            }

            this._renderSettingField(form, app.id, key, field);
        });
    }

    constructor(
        private readonly _service: SettingsService,
        private readonly _uiSettings: UISettingsService,
        private readonly _aiSettings: AISettingsService,
        private readonly _i18nUI: I18nUI,
        private readonly _tauri: TauriProvider,
        _navigation: NavigationService,
    ) {
        this._engineConfigService = new EngineConfigService(_tauri);
        this._modalController = new ModuleSettingsModalController(_navigation);
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
            i18nUI: this._i18nUI,
        };

        // 0. Subscribe to navigation events
        const unsub = eventBus.on('page:change', () => {
            this.close();
        });
        this._unsubscribers.push(unsub);

        // 1. Load Data
        this._loadCardWidths();
        this._bindEvents();

        this._resizer = new CardResizer((id: string, w: string) => {
            this._uiSettings.setCardWidth(id, w);
        });
        this._resizer.init();

        this._bridgeController.install(
            async (app: IApp) => await this._openModuleSettingsHelper(app),
            (btn: HTMLElement, width: string) => {
                this.setCardWidth(btn, width);
            },
        );

        globalThis.addEventListener('lang:changed', this._boundLangChanged);
    }

    public close(): void {
        this._resetAutosaveState();
        this._resetDynamicModuleState();
        delete this._context.currentModule;
        this._modalController.close();
    }

    /**
     * Re-renders the currently open settings module (e.g. on language change).
     */
    public refreshActiveModule(): void {
        const currentApp = this._context.currentModule;

        const modal = document.getElementById('module-settings-modal') as HTMLDialogElement | null;
        const container = document.getElementById('module-config-modal-active');

        if (modal && modal.open && container !== null && currentApp !== undefined) {
            tracer.debug('[ModuleSettingsUI] Refreshing active module settings:', currentApp.id);

            const title = document.getElementById('module-settings-title');
            if (title !== null) {
                title.textContent = this._getModuleSettingsTitle(currentApp);
            }

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
        this._resizer?.destroy();
        this._resizer = null;
        aiSettingsRenderer.destroy();
        this._bridgeController.uninstall();
        tracer.info('[ModuleSettingsUI] Destroyed.');
    }

    /**
     * Renders a specialized module configuration UI (API, Local AI, or generic).
     */
    private async _renderSpecializedModuleConfig(container: HTMLElement, app: IApp) {
        this._resetDynamicModuleState();
        container.classList.remove('module-settings-custom-ui-active');
        document
            .getElementById('module-settings-content')
            ?.classList.remove('module-settings-content-custom-ui');

        if (typeof app.settingsUi === 'string' && app.settingsUi.trim() !== '') {
            await this._renderCustomSettingsUi(container, app);
            return;
        }

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

        if (app.id === 'axelate-telegram-bot') {
            this._renderTelegramBotSettings(container, app);
            return;
        }

        if (app.id === 'comfyui') {
            this._renderComfyUiSettings(container, app);
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

        // Default Schema-based rendering
        container.innerHTML = '';
        if (app.configSchema !== undefined && Object.keys(app.configSchema).length > 0) {
            const form = document.createElement('div');
            form.className = 'module-settings-form';

            form.appendChild(this._createLegacySettingsNotice());

            const header = document.createElement('h3');
            header.style.marginBottom = '1.5rem';
            header.style.color = 'var(--text-primary)';
            header.textContent = app.name !== undefined && app.name !== '' ? app.name : app.id;
            form.appendChild(header);

            this._renderConfigSchemaFields(form, app);
            container.appendChild(form);
        } else {
            this._renderEmptyState(container, app);
        }
    }

    private _createLegacySettingsNotice(): HTMLElement {
        const note = document.createElement('div');
        note.className = 'module-settings-legacy-note';
        note.textContent = this._context.t(
            'ui.settings.legacy_mode_notice',
            'Legacy launcher settings mode',
        );
        return note;
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

    private _renderTelegramBotSettings(container: HTMLElement, _app: IApp): void {
        const t = this._context.t;
        const settings = this._service.getSettings() as Record<string, string | undefined>;

        container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'ai-module-config universal-api-theme';

        const panel = document.createElement('section');
        panel.className = 'ai-content-panel';

        const title = document.createElement('h3');
        title.textContent = t('ui.settings.telegram_stub_title', 'Telegram Bot');

        const description = document.createElement('p');
        description.className = 'stats-note';
        description.textContent = t(
            'ui.settings.telegram_settings_desc',
            'Launcher stores the bot token and target channel here. Bot language follows launcher language.',
        );

        const form = document.createElement('div');
        form.className = 'module-settings-form';

        this._renderSimpleModuleTextField(form, {
            settingKey: 'bot_token',
            label: t('ui.settings.telegram_bot_token', 'Bot Token'),
            value: settings['bot_token'] ?? '',
            placeholder: '123456:ABCDEF...',
            helpText: t(
                'ui.settings.telegram_bot_token_desc',
                'Telegram bot token from BotFather.',
            ),
            type: 'password',
        });
        this._renderSimpleModuleTextField(form, {
            settingKey: 'target_channel_id',
            label: t('ui.settings.telegram_channel_id', 'Target Channel ID'),
            value: settings['target_channel_id'] ?? '',
            placeholder: '-1001234567890',
            helpText: t(
                'ui.settings.telegram_channel_id_desc',
                'Channel ID where posts will be published.',
            ),
            type: 'number',
        });
        this._renderTelegramTopicsField(
            form,
            settings['telegram_topics'] ?? '',
            t('ui.settings.telegram_topics', 'Topics and source channels'),
            t(
                'ui.settings.telegram_topics_desc',
                'One topic per line: Topic: @channel_one, @channel_two',
            ),
        );
        this._renderSimpleModuleSelectField(form, {
            settingKey: 'telegram_source_mode',
            label: t('ui.settings.telegram_source_mode', 'Parser source mode'),
            value: settings['telegram_source_mode'] ?? 'auto',
            helpText: t(
                'ui.settings.telegram_source_mode_desc',
                'Use auto, telethon, or web. Auto tries Telethon first, then web fallback.',
            ),
            options: [
                { value: 'auto', label: 'auto' },
                { value: 'telethon', label: 'telethon' },
                { value: 'web', label: 'web' },
            ],
        });
        this._renderSimpleModuleTextField(form, {
            settingKey: 'telegram_api_id',
            label: t('ui.settings.telegram_api_id', 'Telegram API ID'),
            value: settings['telegram_api_id'] ?? '',
            placeholder: '123456',
            helpText: t(
                'ui.settings.telegram_api_id_desc',
                'Optional MTProto API ID from my.telegram.org for reliable channel parsing.',
            ),
            type: 'number',
        });
        this._renderSimpleModuleTextField(form, {
            settingKey: 'telegram_api_hash',
            label: t('ui.settings.telegram_api_hash', 'Telegram API Hash'),
            value: settings['telegram_api_hash'] ?? '',
            placeholder: '0123456789abcdef...',
            helpText: t(
                'ui.settings.telegram_api_hash_desc',
                'Optional MTProto API hash. Requires an authorized Telethon session.',
            ),
            type: 'password',
        });
        this._renderSimpleModuleTextField(form, {
            settingKey: 'telegram_session',
            label: t('ui.settings.telegram_session', 'Telegram session'),
            value: settings['telegram_session'] ?? '',
            placeholder: 'telegram_parser',
            helpText: t(
                'ui.settings.telegram_session_desc',
                'Telethon session name or path. Leave empty for default Axelate user config path.',
            ),
            type: 'text',
        });
        this._renderSimpleModuleTextareaField(form, {
            settingKey: 'telegram_rewrite_system_prompt',
            label: t('ui.settings.telegram_rewrite_system_prompt', 'Rewrite system prompt'),
            value: settings['telegram_rewrite_system_prompt'] ?? '',
            placeholder: t(
                'ui.settings.telegram_rewrite_system_prompt_placeholder',
                'Describe how the bot should rewrite posts.',
            ),
            helpText: t(
                'ui.settings.telegram_rewrite_system_prompt_desc',
                'Main instruction for post rewriting. Leave empty to use the built-in rewrite style.',
            ),
            rows: 5,
        });
        this._renderSimpleModuleTextareaField(form, {
            settingKey: 'telegram_rewrite_user_prompt',
            label: t('ui.settings.telegram_rewrite_user_prompt', 'Rewrite user prompt'),
            value: settings['telegram_rewrite_user_prompt'] ?? '',
            placeholder: 'Перепиши этот текст:\n\n{text}',
            helpText: t(
                'ui.settings.telegram_rewrite_user_prompt_desc',
                'Prompt template sent with the source post. Use {text} where the original post should be inserted.',
            ),
            rows: 4,
        });
        this._renderSimpleModuleTextareaField(form, {
            settingKey: 'telegram_rewrite_cliches',
            label: t('ui.settings.telegram_rewrite_cliches', 'Rewrite banned cliches'),
            value: settings['telegram_rewrite_cliches'] ?? '',
            placeholder: t(
                'ui.settings.telegram_rewrite_cliches_placeholder',
                'a you know, unbelievable, wow',
            ),
            helpText: t(
                'ui.settings.telegram_rewrite_cliches_desc',
                'Optional list of phrases the bot should avoid. Separate with commas or one phrase per line.',
            ),
            rows: 4,
        });

        const languageNote = document.createElement('p');
        languageNote.className = 'stats-note';
        languageNote.textContent = t(
            'ui.settings.telegram_language_note',
            'Bot language uses the current launcher language.',
        );

        const runtimeNote = document.createElement('p');
        runtimeNote.className = 'stats-note';
        runtimeNote.textContent = t(
            'ui.settings.telegram_runtime_note',
            'Topics, publish channel and parser mode update while the bot is running. Bot token changes require restart.',
        );

        form.appendChild(languageNote);
        form.appendChild(runtimeNote);
        panel.appendChild(title);
        panel.appendChild(description);
        panel.appendChild(form);
        wrapper.appendChild(panel);
        container.appendChild(wrapper);
    }

    private _renderSimpleModuleTextField(
        form: HTMLElement,
        options: {
            settingKey: string;
            label: string;
            value: string;
            placeholder: string;
            helpText: string;
            type: 'text' | 'password' | 'number';
        },
    ): void {
        const row = document.createElement('div');
        row.className = 'form-row';

        const label = document.createElement('label');
        label.textContent = options.label;
        row.appendChild(label);

        const input = document.createElement('input');
        input.className = 'form-input';
        input.type = options.type;
        input.placeholder = options.placeholder;
        input.value = options.value;
        input.autocomplete = 'off';
        input.addEventListener('input', () => {
            this._debouncedSave(options.settingKey, input.value.trim());
        });
        row.appendChild(input);

        const help = document.createElement('div');
        help.className = 'setting-desc';
        help.textContent = options.helpText;
        row.appendChild(help);

        form.appendChild(row);
    }

    private _renderSimpleModuleTextareaField(
        form: HTMLElement,
        options: {
            settingKey: string;
            label: string;
            value: string;
            placeholder: string;
            helpText: string;
            rows?: number;
        },
    ): void {
        const row = document.createElement('div');
        row.className = 'form-row';

        const label = document.createElement('label');
        label.textContent = options.label;
        row.appendChild(label);

        const textarea = document.createElement('textarea');
        textarea.className = 'form-input';
        textarea.rows = options.rows ?? 4;
        textarea.placeholder = options.placeholder;
        textarea.value = options.value;
        textarea.addEventListener('input', () => {
            this._debouncedSave(options.settingKey, textarea.value.trim());
        });
        row.appendChild(textarea);

        const help = document.createElement('div');
        help.className = 'setting-desc';
        help.textContent = options.helpText;
        row.appendChild(help);

        form.appendChild(row);
    }

    private _renderSimpleModuleSelectField(
        form: HTMLElement,
        options: {
            settingKey: string;
            label: string;
            value: string;
            helpText: string;
            options: Array<{ value: string; label: string }>;
        },
    ): void {
        const row = document.createElement('div');
        row.className = 'form-row';

        const label = document.createElement('label');
        label.textContent = options.label;
        row.appendChild(label);

        const select = document.createElement('select');
        select.className = 'form-input';
        for (const option of options.options) {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            select.appendChild(optionElement);
        }
        select.value = options.value;
        select.addEventListener('change', () => {
            this._debouncedSave(options.settingKey, select.value);
        });
        row.appendChild(select);

        const help = document.createElement('div');
        help.className = 'setting-desc';
        help.textContent = options.helpText;
        row.appendChild(help);

        form.appendChild(row);
    }

    private _renderTelegramTopicsField(
        form: HTMLElement,
        storedValue: string,
        labelText: string,
        helpText: string,
    ): void {
        const row = document.createElement('div');
        row.className = 'form-row';

        const label = document.createElement('label');
        label.textContent = labelText;
        row.appendChild(label);

        const textarea = document.createElement('textarea');
        textarea.className = 'form-input';
        textarea.rows = 6;
        textarea.placeholder = 'News: @my_channel, @second_channel';
        textarea.value = this._decodeTelegramTopicsForDisplay(storedValue);
        textarea.addEventListener('input', () => {
            this._debouncedSave(
                'telegram_topics',
                this._encodeTelegramTopicsForStorage(textarea.value),
            );
        });
        row.appendChild(textarea);

        const help = document.createElement('div');
        help.className = 'setting-desc';
        help.textContent = helpText;
        row.appendChild(help);

        form.appendChild(row);
    }

    private _decodeTelegramTopicsForDisplay(value: string): string {
        return value
            .split('|')
            .map((entry) => entry.trim())
            .filter((entry) => entry !== '')
            .join('\n');
    }

    private _encodeTelegramTopicsForStorage(value: string): string {
        return value
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter((entry) => entry !== '')
            .join(' | ');
    }

    private _renderComfyUiSettings(container: HTMLElement, app: IApp): void {
        const t = this._context.t;
        container.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'ai-module-config';

        const panel = document.createElement('section');
        panel.className = 'ai-content-panel';

        const title = document.createElement('h3');
        title.textContent = t('ui.settings.comfyui.title', 'Configure in ComfyUI');

        const description = document.createElement('p');
        description.className = 'stats-note';
        description.textContent = t(
            'ui.settings.comfyui.desc',
            'Models, custom nodes, workflows and manager settings are configured in the ComfyUI browser UI.',
        );

        const note = document.createElement('p');
        note.className = 'stats-note';
        note.textContent = t(
            'ui.settings.comfyui.note',
            'Axelate starts the local ComfyUI module and sends generation requests through its HTTP API.',
        );

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.justifyContent = 'center';
        actions.style.marginTop = '0.5rem';

        const openButton = document.createElement('button');
        openButton.className = 'modal-btn modal-btn-primary';
        openButton.textContent = t('ui.settings.comfyui.open', 'Open ComfyUI');
        openButton.addEventListener('click', () => {
            void this._openComfyUiBrowser(app);
        });

        actions.appendChild(openButton);
        panel.appendChild(title);
        panel.appendChild(description);
        panel.appendChild(note);
        panel.appendChild(actions);
        wrapper.appendChild(panel);
        container.appendChild(wrapper);
    }

    private async _openComfyUiBrowser(app: IApp): Promise<void> {
        const baseUrl = this._getComfyUiBaseUrl();

        try {
            if (this._tauri.isTauri()) {
                const result = await this._tauri.invoke<{ action?: string }>('launch_module', {
                    moduleId: app.id,
                });

                if (result.action === 'start_local') {
                    await this._tauri.invoke('control_module', {
                        request: {
                            module_id: app.id,
                            action: 'start',
                        },
                    });
                }
            }

            await new Promise((resolve) => {
                globalThis.setTimeout(resolve, 1200);
            });
            await this._tauri.openUrl(baseUrl);
        } catch (error: unknown) {
            tracer.error('[ModuleSettingsUI] Failed to open ComfyUI browser settings', error);
            this._context.showToast(
                this._context.t(
                    'ui.settings.comfyui.open_failed',
                    'Failed to open ComfyUI in your browser.',
                ),
                'error',
            );
        }
    }

    private _getComfyUiBaseUrl(): string {
        const settings = this._service.getSettings() as Record<string, string | undefined>;
        const raw = settings['comfyui_base_url']?.trim() ?? '';
        const trimTrailingSlashes = (value: string): string => {
            let end = value.length;
            while (end > 0 && value[end - 1] === '/') {
                end -= 1;
            }

            return value.slice(0, end);
        };

        if (raw === '') {
            return 'http://127.0.0.1:8188';
        }

        if (raw.startsWith('http://') || raw.startsWith('https://')) {
            return trimTrailingSlashes(raw);
        }

        return `http://${trimTrailingSlashes(raw)}`;
    }

    /**
     * Renders engine config form for local engines (llamacpp, sdcpp, etc.).
     * Loads the persisted EngineConfig from Tauri, renders fields, saves on change.
     */
    private async _renderLocalEngineConfig(container: HTMLElement, app: IApp): Promise<void> {
        await this._getEngineRenderer().render(container, app);
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

    private async _renderCustomSettingsUi(container: HTMLElement, app: IApp): Promise<void> {
        await this._getCustomUiController().render(container, app);
    }

    private _showDirtySettingsIndicator(): void {
        const indicator = document.getElementById('save-indicator');
        if (indicator === null) {
            return;
        }

        indicator.classList.add('show');
        const span = indicator.querySelector('span');
        if (span !== null) {
            span.style.color = 'var(--text-secondary)';
            span.textContent = this._context.t('ui.settings.unsaved_changes', 'Unsaved changes');
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
        this._engineRenderer?.reset();

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

        this._resetAutosaveState();
        this._context.currentModule = app;

        title.textContent = this._getModuleSettingsTitle(app);

        await this._renderSpecializedModuleConfig(container, app);
        this._context.i18nUI.applyTranslations(container);

        this._modalController.open(
            app.id,
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
    }

    private _getModuleSettingsTitle(app: IApp): string {
        const suffix = this._context.t('ui.settings.header_suffix', 'Settings');
        if (typeof app.settingsUi === 'string' && app.settingsUi.trim() !== '') {
            return suffix;
        }

        const legacy = this._context.t('ui.settings.legacy_badge', 'Legacy');
        return `${suffix} • ${legacy}`;
    }

    private _debouncedSave(key: string, value: string | number | boolean | null): void {
        this._getAutosaveController().debouncedSave(key, value);
    }

    private _resetAutosaveState(): void {
        this._getAutosaveController().reset();
    }

    private _showSaveIndicator(): void {
        this._getAutosaveController().showPending();
    }

    private _hideSaveIndicator(): void {
        this._getAutosaveController().hide();
    }

    private _getAutosaveController(): ModuleSettingsAutosaveController {
        this._autosaveController ??= new ModuleSettingsAutosaveController(
            (key, defaultValue) => this._context.t(key, defaultValue),
            async (key, value) => await this._service.saveSetting(key, value),
        );

        return this._autosaveController;
    }

    private _getEngineRenderer(): ModuleSettingsEngineRenderer {
        this._engineRenderer ??= new ModuleSettingsEngineRenderer({
            service: this._service,
            tauri: this._tauri,
            engineConfigService: this._engineConfigService,
            getContext: () => this._context,
            registerCleanup: (cleanup) => {
                this._registerModuleCleanup(cleanup);
            },
            debouncedSave: (key, value) => {
                this._debouncedSave(key, value);
            },
            showSaveIndicator: () => {
                this._showSaveIndicator();
            },
        });

        return this._engineRenderer;
    }

    private _getCustomUiController(): ModuleSettingsCustomUiController {
        this._customUiController ??= new ModuleSettingsCustomUiController({
            service: this._service,
            translate: (key, defaultValue) => this._context.t(key, defaultValue),
            registerCleanup: (cleanup) => {
                this._registerModuleCleanup(cleanup);
            },
            showDirtyIndicator: () => {
                this._showDirtySettingsIndicator();
            },
            showSavedIndicator: () => {
                this._showSaveIndicator();
            },
            hideSavedIndicator: () => {
                this._hideSaveIndicator();
            },
            showToast: (message, type) => {
                const toastType = type === 'success' || type === 'error' ? type : 'info';
                this._context.showToast(message, toastType);
            },
        });

        return this._customUiController;
    }

    // Compatibility façade for legacy tests and old call sites while implementation
    // lives in dedicated controllers after the settings refactor.
    private get _engineRendererCompat(): EngineRendererCompat {
        return this._getEngineRenderer() as unknown as EngineRendererCompat;
    }

    public get _extraArgsControls(): EngineRendererCompat['_extraArgsControls'] {
        return this._engineRendererCompat._extraArgsControls;
    }

    public _escapeHtml(value: string): string {
        return this._engineRendererCompat._escapeHtml(value);
    }

    public _getModelFileName(path: string): string {
        return this._engineRendererCompat._getModelFileName(path);
    }

    public _getEngineConfigHtml(
        app: IApp,
        config:
            | {
                  [key: string]: string | number | string[] | undefined;
              }
            | null,
    ): string {
        return this._engineRendererCompat._getEngineConfigHtml(app, config);
    }

    public _appendExtraArgs(appId: string, groups: string[]): number {
        return this._engineRendererCompat._appendExtraArgs(appId, groups);
    }

    public _toggleEngineInfoPopover(anchor: HTMLButtonElement, appId: string): void {
        this._engineRendererCompat._toggleEngineInfoPopover(anchor, appId);
    }

    public _closeEngineInfoPopover(): void {
        this._engineRendererCompat._closeEngineInfoPopover();
    }

    public _createTextAreaField(options: { placeholder?: string }): HTMLTextAreaElement {
        return this._engineRendererCompat._createTextAreaField(options);
    }

    public _createTextInputField(options: {
        type: string;
        placeholder?: string;
        min?: number;
        max?: number;
    }): HTMLInputElement {
        return this._engineRendererCompat._createTextInputField(options);
    }

    public _setupEngineFieldInitialValue(
        input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
        options: {
            key: string;
            isEngineConfig: boolean;
            defaultValue?: number | string;
            config:
                | {
                      [key: string]: string | number | string[] | undefined;
                  }
                | null;
        },
    ): void {
        this._engineRendererCompat._setupEngineFieldInitialValue(input, options);
    }

    public _parseEngineFieldValue(
        raw: string,
        options: {
            type: 'number' | 'text' | 'select' | 'password' | 'textarea';
            min?: number;
            max?: number;
            defaultValue?: number | string;
        },
    ): { value: string | number | null; displayValue: string } {
        return this._engineRendererCompat._parseEngineFieldValue(raw, options);
    }

    public _formatEngineFieldSaveValue(
        key: string,
        value: string | number | null,
    ): string | number | string[] | null {
        return this._engineRendererCompat._formatEngineFieldSaveValue(key, value);
    }

    public _handleEngineFieldSave(
        input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
        options: {
            key: string;
            type: 'number' | 'text' | 'select' | 'password' | 'textarea';
            isEngineConfig: boolean;
            isFile?: boolean;
            config:
                | {
                      [key: string]: string | number | string[] | undefined;
                  }
                | null;
            min?: number;
            max?: number;
            defaultValue?: number | string;
            appId: string;
        },
    ): void {
        this._engineRendererCompat._handleEngineFieldSave(input, options);
    }

    public _createCustomSelectField(options: { options?: string[] }): {
        root: HTMLDivElement;
        destroy: () => void;
    } {
        const control = this._engineRendererCompat._createCustomSelectField(options);
        return {
            root: control.root,
            destroy: control.destroy,
        };
    }

    public _createExtraArgsField(options: { placeholder?: string; defaultValue?: number | string }): {
        root: HTMLDivElement;
        input: HTMLInputElement;
        syncTokens: () => void;
        getGroups: () => string[];
        setGroups: (groups: string[]) => void;
    } {
        return this._engineRendererCompat._createExtraArgsField(options);
    }

    public _addFileBrowseButton(
        container: HTMLElement,
        input: HTMLInputElement,
        isImage: boolean,
    ): void {
        this._engineRendererCompat._addFileBrowseButton(container, input, isImage);
    }

    public _renderEngineFieldRow(container: HTMLElement, options: Record<string, unknown>): void {
        this._engineRendererCompat._renderEngineFieldRow(container, options);
    }

    public _renderPerformanceModeFieldRow(container: HTMLElement, appId: string): void {
        this._engineRendererCompat._renderPerformanceModeFieldRow(container, appId);
    }
}
